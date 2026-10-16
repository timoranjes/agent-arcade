import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentNode, FeedEntry, LimitSample, TurnStats } from '../types'
import {
  MAIN,
  PARK_MS,
  addSample,
  addToTurn,
  addUsage,
  crossedThresholds,
  describeTarget,
  duration,
  finishFeed,
  mainNode,
  patchAgent,
  pushFeed,
  runningCount,
  shortModel,
  spawnAgent,
  stageView,
  totalTokens,
} from './model'
import { Band, DashPane, FeedPane, StaticStage } from './views'

const DASH = 'arcade-dash'
const FEED = 'arcade-feed'

const agents = atom({ plugin: 'agent-arcade', key: 'agents' } as const, {} as Record<string, AgentNode>)
const feed = atom({ plugin: 'agent-arcade', key: 'feed' } as const, [] as FeedEntry[])
const turn = atom({ plugin: 'agent-arcade', key: 'turn' } as const, null as TurnStats | null)
const tick = atom({ plugin: 'agent-arcade', key: 'tick' } as const, 0)
const stageDown = atom({ plugin: 'agent-arcade', key: 'stageDown' } as const, false)
const samples = atom({ plugin: 'agent-arcade', key: 'samples' } as const, {} as Record<string, LimitSample[]>)
const warned = atom({ plugin: 'agent-arcade', key: 'warned' } as const, [] as string[])

/** Bookkeeping must never break Claude's own work: swallow its failures. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // the view is best-effort
  }
}

async function openPanes($: EngineInterface) {
  await $.ui.open({ id: DASH, title: '📊 Dashboard' })
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
      await update($, stageDown, () => false)
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
      await update($, warned, () => [])
      return { text: '🧹 Arcade reset.' }
    }
    const panes = await $.ui.panes()
    const isOpen = panes.some(p => (p.id === DASH || p.id === FEED) && p.isShown)
    if (isOpen) {
      await $.ui.close({ id: DASH })
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
        const prev = (await read($, agents))[MAIN]
        await update($, turn, () => ({ startedAt: now, tools: 0, files: [], agents: 0, tokens: 0, cacheRead: 0 }))
        // A new prompt: keep agents still working in the background, drop finished ones.
        await update($, agents, list => ({
          ...Object.fromEntries(Object.entries(list).filter(([id, n]) => id !== MAIN && n.status === 'running')),
          [MAIN]: { ...mainNode(now), model: prev?.model, effort: prev?.effort },
        }))
      } else {
        const id = e.agentId
        await update($, agents, list => patchAgent(list, id, () => ({ status: 'running', endedAt: undefined })))
      }
      startTicker($)
    })

    return next(e)
  })

  // Each request names the model and effort it is really sent with: record them, change nothing.
  on('turn.step', async function* ($, e, next) {
    await quietly(async () => {
      const who = e.agentId ?? MAIN
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, agents, list => {
        const node = list[who]
        if (node && node.model === e.model && node.effort === effort) return list
        return patchAgent(list, who, () => ({ model: e.model, effort }))
      })
    })

    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await quietly(async () => {
      if (spawned.deny !== undefined || !spawned.agentId) return
      const id = spawned.agentId
      const now = await $.clock.now()
      await update($, agents, list =>
        patchAgent(
          spawnAgent(list, { id, type: e.subagentType, description: e.description, parentId: e.parentAgentId, fork: e.fork }, now),
          id,
          () => ({ model: spawned.model }),
        ),
      )
      await update($, turn, t => (t ? { ...t, agents: t.agents + 1 } : t))
      startTicker($)
    })

    return spawned
  }).catch(($, e, next) => next(e)) // an observer: never block a spawn

  // The engine is about to ask the person; the ask clears when that call ends.
  on('classic.PermissionRequest', async ($, e, next) => {
    await quietly(async () => {
      const who = e.agent_id ?? MAIN
      const target = describeTarget((e.tool_input ?? {}) as Record<string, unknown>)
      const label = target ? `${e.tool_name} ${target}` : e.tool_name
      await update($, agents, list => patchAgent(list, who, () => ({ waiting: label })))
    })

    return next(e)
  }).catch(($, e, next) => next(e))

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
      await update($, agents, all =>
        patchAgent(all, who, n => ({
          tools: n.tools + 1,
          failures: (n.failures ?? 0) + (isOk ? 0 : 1),
          tool: undefined,
          waiting: undefined,
        })),
      )
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
      const who = e.agentId ?? MAIN
      const used = e.usage
      if (used) {
        await update($, agents, list => patchAgent(list, who, n => addUsage(n, used)))
        await update($, turn, t =>
          t ? { ...t, tokens: (t.tokens ?? 0) + totalTokens(used), cacheRead: (t.cacheRead ?? 0) + used.cache_read_input_tokens } : t,
        )
      }
      if (e.agentId !== undefined) {
        const id = e.agentId
        const node = (await read($, agents))[id]
        await update($, agents, list =>
          patchAgent(list, id, () => ({ status: isOk ? 'done' : 'failed', endedAt: now, tool: undefined, waiting: undefined })),
        )
        // Fold the parked lane into the summary once its time is up.
        $.clock.after(PARK_MS + 500, () => void update($, tick, n => n + 1))
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
          patchAgent(list, MAIN, () => ({ status: isOk ? 'done' : 'failed', endedAt: now, tool: undefined, waiting: undefined })),
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

  // Usage pushed by the engine: keep rate-limit history for the burn rate, warn once past thresholds.
  on('session.measure', async ($, e, next) => {
    await quietly(async () => {
      const now = await $.clock.now()
      if (e.changed.includes('rateLimits')) {
        await update($, samples, all => {
          const out = { ...all }
          for (const l of e.rateLimits) out[l.kind] = addSample(all[l.kind], { at: now, percent: l.percentUsed })
          return out
        })
      }
      const fresh = crossedThresholds(e.context.percent, e.rateLimits, await read($, warned))
      if (fresh.length > 0) {
        await update($, warned, list => [...list, ...fresh.map(f => f.key)])
        for (const f of fresh) $.ui.toast(f.text)
      }
      await update($, tick, n => n + 1)
    })

    return next(e)
  })

  // A stage that failed to load or draw: fall back to the still one.
  on('ui.fault', async ($, e, next) => {
    await quietly(() => update($, stageDown, () => true))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const elements = $.ui.resolve(e)
    const list = await read($, agents)
    const usage = await $.session.usage()
    const isDashUp = (await $.ui.panes()).some(p => p.id === DASH && p.isShown)

    return Band(elements, {
      model: list[MAIN]?.model ?? (await $.session.model()),
      effort: list[MAIN]?.effort,
      isCompact: isDashUp,
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

  on('ui.render', { component: 'Pane', requestId: DASH }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined // terminal and desktop only
    const list = await read($, agents)
    const now = await $.clock.now()
    await read($, tick) // redraw with the clock while busy
    const rows = e.viewport?.rows ?? 30
    const view = stageView(list, now, Math.max(1, Math.floor((rows - 12) / 2)))
    const isBusy = list[MAIN]?.status === 'running' || runningCount(list) > 0
    const main = view.lanes.find(l => l.id === MAIN)
    if (main && !isBusy) {
      main.stats = [shortModel(list[MAIN]?.model), list[MAIN]?.effort ?? '-', '  ready for your next prompt'].join(' ')
    }

    const canAnimate = Client !== undefined && !(await read($, stageDown))
    const empty = <Text dimColor>No agents yet. Send a prompt to start the show ✨</Text>
    const stage =
      view.lanes.length === 0 ? empty
      : canAnimate && Client ? <Client key="stage" module="./stage.tsx" width="100%" props={{ lanes: view.lanes }} />
      : StaticStage(elements, view)
    const usage = await $.session.usage()
    const data = { view, usage, samples: await read($, samples), turn: await read($, turn), isBusy, now, columns: e.props.bodyColumns }

    return DashPane(elements, data, stage)
  })

  on('ui.render', { component: 'Pane', requestId: FEED }, async ($, e) => {
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 2)
    return FeedPane($.ui.resolve(e), await read($, feed), room, await read($, tick))
  })
}
