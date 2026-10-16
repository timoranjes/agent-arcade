import type { ElementTable } from 'claude-code'

import type { AgentNode, FeedEntry, TurnStats } from '../types'
import { MAIN, SPINNER, bar, duration, tokens, treeOrder } from './model'

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
      <Text>{d.model}</Text>
      <Text dimColor>│</Text>
      <Text>
        ctx <Text color={ctxColor}>{bar(pct)}</Text> {Math.round(pct)}%
        {d.contextTokens !== undefined ? <Text dimColor> ({tokens(d.contextTokens)})</Text> : null}
      </Text>
      {d.usd !== undefined ? <Text dimColor>│</Text> : null}
      {d.usd !== undefined ? <Text>💰 ${d.usd.toFixed(2)}</Text> : null}
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

export function TreePane({ Box, Text }: El, agents: Record<string, AgentNode>, now: number, tick: number) {
  const rows = treeOrder(agents)
  const spin = SPINNER[tick % SPINNER.length]

  return (
    <Box flexDirection="column">
      {rows.length === 0 ? <Text dimColor>No agents yet. Send a prompt to start the show ✨</Text> : null}
      {rows.map(({ node, depth }) => {
        const mark =
          node.status === 'running' ? <Text color={node.color}>{spin}</Text>
          : node.status === 'done' ? <Text color="success">✔</Text>
          : <Text color="error">✘</Text>
        const age = duration((node.endedAt ?? now) - node.startedAt)
        return (
          <Box key={node.id} flexDirection="column">
            <Text wrap="truncate-end">
              {'  '.repeat(depth)}{depth > 0 ? '└ ' : ''}{mark} {node.icon}{' '}
              <Text color={node.color} weight="bold">{node.type}</Text>
              {node.id !== MAIN ? <Text dimColor> · {node.description}</Text> : null}
              <Text dimColor> · {age} · 🔧{node.tools}</Text>
            </Text>
            {node.status === 'running' && node.tool ? (
              <Text wrap="truncate-end" dimColor>
                {'  '.repeat(depth + 2)}↳ {node.tool}
              </Text>
            ) : null}
          </Box>
        )
      })}
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
