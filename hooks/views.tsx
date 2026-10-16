import type { ElementTable, RenderElement, SessionUsage } from 'claude-code'

import type { FeedEntry, LimitSample, TurnStats } from '../types'
import type { StageView } from './model'
import {
  MAIN,
  SPINNER,
  bar,
  burnRate,
  cacheRate,
  duration,
  levelColor,
  resetsIn,
  shortModel,
  tokens,
  windowName,
} from './model'

type El = Pick<ElementTable, 'Box' | 'Text'>

export type BandData = {
  model: string
  percent?: number
  contextTokens?: number
  usd?: number
  running: number
  turn: TurnStats | null
  isBusy: boolean
  now: number
  tick: number
  /** The main loop's latest effort, from turn.step. */
  effort?: string
  /** While the dashboard shows usage, the band keeps to model, time and agents. */
  isCompact?: boolean
}

export function Band({ Box, Text }: El, d: BandData) {
  const spin = SPINNER[d.tick % SPINNER.length]
  const elapsed = d.turn ? duration((d.turn.endedAt ?? d.now) - d.turn.startedAt) : undefined
  const pct = d.percent ?? 0
  const ctxColor = pct >= 80 ? 'error' : pct >= 60 ? 'warning' : 'success'

  return (
    <Box flexDirection="row" gap={1}>
      <Text color="claude" weight="bold">🕹️ arcade</Text>
      <Text dimColor>│</Text>
      <Text>{shortModel(d.model)}{d.effort ? ` ${d.effort}` : ''}</Text>
      {d.isCompact ? null : <Text dimColor>│</Text>}
      {d.isCompact ? null : <Text>
        ctx <Text color={ctxColor}>{bar(pct)}</Text> {Math.round(pct)}%
        {d.contextTokens !== undefined ? <Text dimColor> ({tokens(d.contextTokens)})</Text> : null}
      </Text>}
      {d.usd !== undefined && !d.isCompact ? <Text dimColor>│</Text> : null}
      {d.usd !== undefined && !d.isCompact ? <Text>💰 ${d.usd.toFixed(2)}</Text> : null}
      <Text dimColor>│</Text>
      <Text color={d.running > 0 ? 'cyan' : undefined} dimColor={d.running === 0}>
        🏃 {d.running} agent{d.running === 1 ? '' : 's'}
      </Text>
      {elapsed ? <Text dimColor>│</Text> : null}
      {elapsed ? (
        <Text>
          ⏱ {elapsed} {d.isBusy ? <Text color="claude">{spin}</Text> : <Text color="success">✔</Text>}
        </Text>
      ) : null}
      {d.turn && d.turn.tools > 0 ? <Text dimColor>│ 🔧 {d.turn.tools}</Text> : null}
    </Box>
  )
}

export function FeedPane({ Box, Text }: El, feed: FeedEntry[], room: number, tick: number) {
  const spin = SPINNER[tick % SPINNER.length]
  const shown = feed.slice(-room).reverse()

  return (
    <Box flexDirection="column">
      {shown.length === 0 ? <Text dimColor>Quiet in here… tool calls will scroll by 🎮</Text> : null}
      {shown.map(entry => (
        <Text key={entry.id} wrap="truncate-end">
          {entry.ok === null ? <Text color={entry.color}>{spin}</Text>
            : entry.ok ? <Text color="success">✔</Text>
            : <Text color="error">✘</Text>}{' '}
          {entry.icon} <Text color={entry.color} weight="bold">{entry.tool}</Text>
          {entry.target ? <Text> {entry.target}</Text> : null}
          {entry.ms !== undefined ? <Text dimColor> {entry.ms < 1000 ? `${entry.ms}ms` : duration(entry.ms)}</Text> : null}
        </Text>
      ))}
    </Box>
  )
}

const NARROW = 60

function baseName(path: string): string {
  return path.split(/[\/]/).filter(Boolean).pop() ?? path
}

/** The stage drawn once, without motion: for surfaces with no Client, or after the stage failed. */
export function StaticStage({ Box, Text }: El, view: StageView) {
  return (
    <Box flexDirection="column">
      {view.lanes.map(lane => (
        <Box key={lane.id} flexDirection="column">
          <Text wrap="truncate-end">
            {lane.status === 'failed' ? '💥' : lane.id === MAIN && lane.status !== 'running' ? '💤' : lane.icon}{' '}
            <Text color={lane.color} weight="bold">{lane.name}</Text>
            {lane.status === 'done' && lane.id !== MAIN ? <Text color="success"> ✔</Text> : null}
            {lane.waiting ? <Text color="warning"> ⏸ asked you to approve {lane.waiting}</Text>
              : lane.bubble ? <Text dimColor> ⟨{lane.bubble}⟩</Text> : null}
          </Text>
          <Text wrap="truncate-end" dimColor>   {lane.stats}</Text>
        </Box>
      ))}
    </Box>
  )
}

export type DashData = {
  view: StageView
  usage: SessionUsage
  samples: Record<string, LimitSample[]>
  turn: TurnStats | null
  isBusy: boolean
  now: number
  columns: number
}

function Meter({ Text }: El, name: string, percent: number, detail: string) {
  const pct = Math.round(percent)
  return (
    <Text key={name} wrap="truncate-end">
      {name.padEnd(9)}<Text color={levelColor(percent)}>{bar(percent, 10)}</Text>  {String(pct).padStart(3)}%   <Text dimColor>{detail}</Text>
    </Text>
  )
}

/** The dashboard: the stage (handed in, animated or not), then usage, then what changed. */
export function DashPane(el: El, d: DashData, stage: RenderElement) {
  const { Box, Text } = el
  const isNarrow = d.columns < NARROW
  const ctx = d.usage.context
  const pct = ctx.percent ?? 0
  const limits = d.usage.rateLimits
  const turn = d.turn
  const turnCache = turn ? cacheRate(turn.cacheRead ?? 0, Math.max(0, (turn.tokens ?? 0) - (turn.cacheRead ?? 0))) : undefined
  const burns = limits
    .map(l => ({ kind: l.kind, text: burnRate(d.samples[l.kind], d.now, l.resetsAt) }))
    .filter(b => b.text)
  const files = turn?.files ?? []
  const folded = d.view.folded

  return (
    <Box flexDirection="column">
      {stage}
      {folded.length > 0 ? (
        <Text wrap="truncate-end" dimColor>
          <Text color="success">✔</Text> {folded.length} finished
          {isNarrow ? '' : `: ${folded.slice(0, 4).map(f => `${f.icon} ${f.name} ${f.took}`).join(', ')}${folded.length > 4 ? ', …' : ''}`}
        </Text>
      ) : null}
      <Text> </Text>
      {!d.isBusy && turn?.endedAt !== undefined ? (
        <Box flexDirection="column">
          <Text wrap="truncate-end" dimColor>
            last turn  {duration(turn.endedAt - turn.startedAt)}   🔧 {turn.tools}
            {turn.agents ? `   ${turn.agents} agent${turn.agents === 1 ? '' : 's'}` : ''}
            {turn.tokens ? `   ${tokens(turn.tokens)} tokens` : ''}
            {files.length ? `   ${files.length} file${files.length === 1 ? '' : 's'}` : ''}
          </Text>
          <Text> </Text>
        </Box>
      ) : null}
      {isNarrow ? (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            ctx <Text color={levelColor(pct)}>{Math.round(pct)}%</Text>
            {limits.map(l => (
              <Text key={l.kind}>
                <Text dimColor> │ </Text>{windowName(l.kind, true)} <Text color={levelColor(l.percentUsed)}>{Math.round(l.percentUsed)}%</Text>
              </Text>
            ))}
            {d.usage.cost ? <Text><Text dimColor> │ </Text>${d.usage.cost.usd.toFixed(2)}</Text> : null}
          </Text>
          {burns.map(b => <Text key={b.kind} dimColor wrap="truncate-end">{windowName(b.kind, true)} {b.text}</Text>)}
        </Box>
      ) : (
        <Box flexDirection="column">
          {Meter(el, 'context', pct, ctx.tokens !== undefined ? `${tokens(ctx.tokens)} of ${tokens(ctx.window)}` : `window ${tokens(ctx.window)}`)}
          {limits.length === 0 ? <Text dimColor>{'limits'.padEnd(9)}no reading yet: they show after the first reply</Text> : null}
          {limits.map(l => {
            const parts = [resetsIn(l.resetsAt, d.now), burns.find(b => b.kind === l.kind)?.text ?? ''].filter(Boolean)
            return Meter(el, windowName(l.kind), l.percentUsed, parts.join(', '))
          })}
          <Text wrap="truncate-end">
            {'spent'.padEnd(9)}{d.usage.cost ? `$${d.usage.cost.usd.toFixed(2)}` : '–'}
            {d.isBusy && turn?.tokens ? <Text dimColor>       this turn {tokens(turn.tokens)} tokens{turnCache !== undefined ? `, cache ${turnCache}%` : ''}</Text> : null}
          </Text>
          {files.length > 0 ? <Text> </Text> : null}
          {files.length > 0 ? (
            <Text wrap="truncate-end">
              {'changed'.padEnd(9)}<Text dimColor>{files.map(baseName).join('  ')}</Text>
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  )
}
