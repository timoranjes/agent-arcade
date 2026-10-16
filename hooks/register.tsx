import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentNode, FeedEntry, TurnStats } from '../types'
import {
  MAIN,
  addToTurn,
  describeTarget,
  duration,
  finishFeed,
  mainNode,
  patchAgent,
  pushFeed,
  runningCount,
  spawnAgent,
} from './model'
import { Band, FeedPane, TreePane } from './views'

const TREE = 'arcade-tree'
const FEED = 'arcade-feed'

const agents = atom({ plugin: 'agent-arcade', key: 'agents' } as const, {} as Record<string, AgentNode>)
const feed = atom({ plugin: 'agent-arcade', key: 'feed' } as const, [] as FeedEntry[])
const turn = atom({ plugin: 'agent-arcade', key: 'turn' } as const, null as TurnStats | null)
const tick = atom({ plugin: 'agent-arcade', key: 'tick' } as const, 0)

/** Bookkeeping must never break Claude's own work: swallow its failures. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // the view is best-effort
  }
}

async function openPanes($: EngineInterface) {
  await $.ui.open({ id: TREE, title: '🕹️ Agents' })
  await $.ui.open({ id: FEED, title: '📜 Activity' })
}

// Redraws spinners and timers while something runs; stopped once all is idle.
let ticker: Timer | undefined
let seq = 0

function startTicker($: EngineInterface) {
  ticker ??= $.clock.every(300, () => void update($, tick, n => n + 1))
}

async function stopTickerIfIdle($: EngineInterface) {
  const list = await read($, agents)
  const isMainBusy = list[MAIN]?.status === 'running'
  if (!isMainBusy && runningCount(list) === 0) {
    ticker?.cancel()
    ticker = undefined
  }
}

export const register: Register = on => {
  ticker = undefined

  on('session.start', async ($, e, next) => {
    await quietly(async () => {
      await $.command.register({
        name: 'arcade',
        description: 'Agent arcade: /arcade (toggle panes) or /arcade reset',
      })
      void openPanes($)
    })

    return next(e)
  })

  on('command.run', { command: 'arcade' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await update($, feed, () => [])
      await update($, agents, list =>
        Object.fromEntries(Object.entries(list).filter(([, n]) => n.status === 'running')),
      )
      return { text: '🧹 Arcade reset.' }
    }
    const panes = await $.ui.panes()
    const isOpen = panes.some(p => (p.id === TREE || p.id === FEED) && p.isShown)
    if (isOpen) {
      await $.ui.close({ id: TREE })
      await $.ui.close({ id: FEED })
      return { text: '🕹️ Arcade panes closed. /arcade brings them back.' }
    }
    await openPanes($)
    return { text: '🕹️ Arcade panes open.' }
  })

  on('turn.start', async ($, e, next) => {
    await quietly(async () => {
      const now = await $.clock.now()
      if (e.agentId === undefined) {
        await update($, turn, () => ({ startedAt: now, tools: 0, files: [], agents: 0 }))
        // A new prompt: keep agents still working in the background, drop finished ones.
        await update($, agents, list => ({
          ...Object.fromEntries(Object.entries(list).filter(([id, n]) => id !== MAIN && n.status === 'running')),
          [MAIN]: mainNode(now),
        }))
      } else {
        const id = e.agentId
        await update($, agents, list => patchAgent(list, id, () => ({ status: 'running', endedAt: undefined })))
      }
      startTicker($)
    })

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await quietly(async () => {
      if (spawned.deny !== undefined || !spawned.agentId) return
      const id = spawned.agentId
      const now = await $.clock.now()
      await update($, agents, list =>
        spawnAgent(list, { id, type: e.subagentType, description: e.description, parentId: e.parentAgentId, fork: e.fork }, now),
      )
      await update($, turn, t => (t ? { ...t, agents: t.agents + 1 } : t))
      startTicker($)
    })

    return spawned
  }).catch(($, e, next) => next(e)) // an observer: never block a spawn

  on('tool.call', async ($, e, next) => {
    const who = e.agentId ?? MAIN
    const args = e as unknown as Record<string, unknown>
    const target = describeTarget(args)
    const callId = `${e.tool_use_id ?? 'call'}-${(seq += 1)}`
    let startedAt = 0

    await quietly(async () => {
      startedAt = await $.clock.now()
      const list = await read($, agents)
      const node = list[who] ?? list[MAIN]
      const icon = node?.icon ?? '🧠'
      const color = node?.color ?? 'claude'
      const label = `${e.tool}${target ? ` ${target}` : ''}`
      await update($, agents, all => patchAgent(all, who, () => ({ tool: label })))
      await update($, feed, f => pushFeed(f, { id: callId, agentId: who, icon, color, tool: e.tool, target, ok: null }))
      $.ui.status(`${icon} ${node?.type ?? 'Claude'} → ${label}`)
    })

    const ran = await next(e)

    await quietly(async () => {
      const ms = Math.round((await $.clock.now()) - startedAt)
      const isOk = ran.deny === undefined && ran.isError !== true
      const file = typeof args.file_path === 'string' ? args.file_path : undefined
      await update($, feed, f => finishFeed(f, callId, isOk, ms))
      await update($, agents, all => patchAgent(all, who, n => ({ tools: n.tools + 1, tool: undefined })))
      await update($, turn, t => addToTurn(t, e.tool, file))
      if (ran.deny !== undefined) $.ui.toast(`🚫 ${e.tool} was denied`)
      else if (!isOk) $.ui.toast(`⚠️ ${e.tool} failed${target ? `: ${target}` : ''}`)
    })

    return ran
  }).catch(($, e, next) => next(e)) // an observer: never block a tool

  on('turn.complete', async ($, e, next) => {
    await quietly(async () => {
      const now = await $.clock.now()
      const isOk = e.reason === 'answer'
      if (e.agentId !== undefined) {
        const id = e.agentId
        const node = (await read($, agents))[id]
        await update($, agents, list =>
          patchAgent(list, id, () => ({ status: isOk ? 'done' : 'failed', endedAt: now, tool: undefined })),
        )
        if (node) {
          const took = duration(now - node.startedAt)
          $.ui.toast(
            isOk
              ? `🎉 ${node.icon} ${node.type} finished · ${took} · ${node.tools} tools`
              : `💥 ${node.icon} ${node.type} stopped (${e.reason}) after ${took}`,
          )
        }
      } else {
        await update($, agents, list =>
          patchAgent(list, MAIN, () => ({ status: isOk ? 'done' : 'failed', endedAt: now, tool: undefined })),
        )
        const t = await read($, turn)
        await update($, turn, s => (s ? { ...s, endedAt: now } : s))
        $.ui.status(undefined)
        if (t && t.tools > 0) {
          const files = t.files.length
          $.ui.toast(
            `🏁 Turn done · ${duration(now - t.startedAt)} · ${t.tools} tools` +
              (files ? ` · ${files} file${files === 1 ? '' : 's'}` : '') +
              (t.agents ? ` · ${t.agents} agent${t.agents === 1 ? '' : 's'}` : ''),
          )
        }
      }
      await stopTickerIfIdle($)
    })

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const elements = $.ui.resolve(e)
    const list = await read($, agents)
    const usage = await $.session.usage()

    return Band(elements, {
      model: await $.session.model(),
      percent: usage.context.percent,
      contextTokens: usage.context.tokens,
      usd: usage.cost?.usd,
      running: runningCount(list),
      turn: await read($, turn),
      isBusy: list[MAIN]?.status === 'running' || runningCount(list) > 0,
      now: await $.clock.now(),
      tick: await read($, tick),
    })
  })

  on('ui.render', { component: 'Pane', requestId: TREE }, async ($, e) =>
    TreePane($.ui.resolve(e), await read($, agents), await $.clock.now(), await read($, tick)),
  )

  on('ui.render', { component: 'Pane', requestId: FEED }, async ($, e) => {
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 2)
    return FeedPane($.ui.resolve(e), await read($, feed), room, await read($, tick))
  })
}
