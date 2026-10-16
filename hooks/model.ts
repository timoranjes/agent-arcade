import type { AgentNode, FeedEntry, LimitSample, TurnStats } from '../types'

export const MAIN = 'main'
export const FEED_CAP = 50
export const SPINNER = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']

const STYLES: Record<string, { icon: string; color: string }> = {
  main: { icon: '🧠', color: 'claude' },
  Explore: { icon: '🔭', color: 'cyan' },
  Plan: { icon: '🗺️', color: 'magenta' },
  'general-purpose': { icon: '🤖', color: 'blue' },
  fork: { icon: '🧬', color: 'green' },
  'claude-code-guide': { icon: '📚', color: 'yellow' },
}
const FALLBACK_ICONS = ['👾', '🦊', '🐙', '🦉', '🐝', '🚀']
const FALLBACK_COLORS = ['yellow', 'green', 'cyan', 'magenta', 'blue']

export function styleFor(type: string): { icon: string; color: string } {
  const known = STYLES[type]
  if (known) return known
  let hash = 0
  for (const ch of type) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return {
    icon: FALLBACK_ICONS[hash % FALLBACK_ICONS.length] ?? '👾',
    color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length] ?? 'yellow',
  }
}

export function mainNode(now: number): AgentNode {
  return {
    id: MAIN,
    type: 'Claude',
    description: 'main loop',
    icon: styleFor('main').icon,
    color: styleFor('main').color,
    startedAt: now,
    status: 'running',
    tools: 0,
  }
}

export function spawnAgent(
  agents: Record<string, AgentNode>,
  spawn: { id: string; type: string; description: string; parentId?: string; fork?: boolean },
  now: number,
): Record<string, AgentNode> {
  const style = styleFor(spawn.fork ? 'fork' : spawn.type)
  return {
    ...agents,
    [spawn.id]: {
      id: spawn.id,
      type: spawn.fork ? 'fork' : spawn.type,
      description: spawn.description,
      parentId: spawn.parentId ?? MAIN,
      icon: style.icon,
      color: style.color,
      startedAt: now,
      status: 'running',
      tools: 0,
    },
  }
}

export function patchAgent(
  agents: Record<string, AgentNode>,
  id: string,
  patch: (node: AgentNode) => Partial<AgentNode>,
): Record<string, AgentNode> {
  const node = agents[id]
  return node ? { ...agents, [id]: { ...node, ...patch(node) } } : agents
}

/** Agents in tree order, each with its depth below the main loop. */
export function treeOrder(agents: Record<string, AgentNode>): { node: AgentNode; depth: number }[] {
  const out: { node: AgentNode; depth: number }[] = []
  const all = Object.values(agents)
  const seen = new Set<string>()
  const walk = (node: AgentNode, depth: number) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    out.push({ node, depth })
    all
      .filter(child => child.parentId === node.id)
      .sort((a, b) => a.startedAt - b.startedAt)
      .forEach(child => walk(child, depth + 1))
  }
  const roots = all.filter(n => n.parentId === undefined || !agents[n.parentId])
  roots.sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : a.startedAt - b.startedAt))
  roots.forEach(root => walk(root, 0))
  return out
}

export function runningCount(agents: Record<string, AgentNode>): number {
  return Object.values(agents).filter(n => n.id !== MAIN && n.status === 'running').length
}

function short(text: string, max = 48): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** A few words for what a tool call is aimed at, from its arguments. */
export function describeTarget(args: Record<string, unknown>): string {
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  const file = str('file_path') ?? str('notebook_path')
  if (file) return baseName(file)
  const pattern = str('pattern')
  if (pattern) return `"${short(pattern, 32)}"`
  const command = str('command')
  if (command) return short(command, 40)
  const desc = str('description')
  if (desc) return short(desc, 40)
  const url = str('url') ?? str('query') ?? str('skill') ?? str('prompt')
  return url ? short(url, 40) : ''
}

export function pushFeed(feed: FeedEntry[], entry: FeedEntry): FeedEntry[] {
  return [...feed, entry].slice(-FEED_CAP)
}

export function finishFeed(feed: FeedEntry[], id: string, ok: boolean, ms: number): FeedEntry[] {
  return feed.map(one => (one.id === id ? { ...one, ok, ms } : one))
}

export function addToTurn(turn: TurnStats | null, tool: string, file?: string): TurnStats | null {
  if (!turn) return turn
  const isWrite = tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit'
  const files = isWrite && file && !turn.files.includes(file) ? [...turn.files, file] : turn.files
  return { ...turn, tools: turn.tools + 1, files }
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function bar(percent: number, width = 8): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

export function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** All the tokens a call was answered over and generated. */
export function totalTokens(u: Usage): number {
  return u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

/** Folds one turn's usage into an agent's running totals. */
export function addUsage(node: AgentNode, u: Usage): Partial<AgentNode> {
  return {
    tokensIn: (node.tokensIn ?? 0) + u.input_tokens + u.cache_creation_input_tokens,
    tokensOut: (node.tokensOut ?? 0) + u.output_tokens,
    cacheRead: (node.cacheRead ?? 0) + u.cache_read_input_tokens,
  }
}

export function agentTokens(node: AgentNode): number {
  return (node.tokensIn ?? 0) + (node.tokensOut ?? 0) + (node.cacheRead ?? 0)
}

/** The share of input the prompt cache served, as a whole percent; undefined before any input. */
export function cacheRate(cacheRead: number, input: number): number | undefined {
  const all = cacheRead + input
  return all > 0 ? Math.round((cacheRead / all) * 100) : undefined
}

/** `claude-opus-5-5` → `opus-5-5`; a dated suffix dropped. */
export function shortModel(model: string | undefined): string {
  if (!model) return '–'
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[1m\]$/, '')
}

const WINDOW_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'spend' }
const WINDOW_SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$lim' }

export function windowName(kind: string, isShort = false): string {
  return (isShort ? WINDOW_SHORT[kind] : WINDOW_NAMES[kind]) ?? kind.replace(/_/g, ' ')
}

function span(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** "resets in 2h 10m" for a reset time ahead of now; empty when unknown or past. */
export function resetsIn(resetsAt: string | undefined, now: number): string {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  return Number.isFinite(at) && at > now ? `resets in ${span(at - now)}` : ''
}

const SAMPLE_CAP = 30
const MIN_SPAN_MS = 2 * 60_000

/** Adds a reading; a drop in percent means the window reset, so the history starts over. */
export function addSample(list: LimitSample[] | undefined, sample: LimitSample): LimitSample[] {
  const prev = list ?? []
  const last = prev[prev.length - 1]
  if (last && sample.percent < last.percent) return [sample]
  return [...prev, sample].slice(-SAMPLE_CAP)
}

/**
 * When the window fills at the pace of its readings: "limit in ~1h 20m".
 * Empty with too little history, no climb, or a reset that comes first.
 */
export function burnRate(list: LimitSample[] | undefined, now: number, resetsAt?: string): string {
  const first = list?.[0]
  const last = list?.[list.length - 1]
  if (!first || !last || last.at - first.at < MIN_SPAN_MS || last.percent <= first.percent) return ''
  if (last.percent >= 100) return 'limit reached'
  const perMs = (last.percent - first.percent) / (last.at - first.at)
  const eta = (100 - last.percent) / perMs - (now - last.at)
  const reset = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isFinite(reset) && now + eta >= reset) return ''
  return `limit in ~${span(Math.max(0, eta))}`
}

/** Thresholds that toast once each: context at 80%, a rate-limit window at 90%. */
export function crossedThresholds(
  context: number | undefined,
  limits: readonly { kind: string; percentUsed: number }[],
  warned: readonly string[],
): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  if ((context ?? 0) >= 80 && !warned.includes('context')) {
    out.push({ key: 'context', text: `🟥 Context is ${Math.round(context ?? 0)}% full: /compact soon` })
  }
  for (const l of limits) {
    if (l.percentUsed >= 90 && !warned.includes(l.kind)) {
      out.push({ key: l.kind, text: `🟥 ${windowName(l.kind)} limit is at ${Math.round(l.percentUsed)}%` })
    }
  }
  return out
}

/** Bar color by fill: calm, then warning at 60%, error at 80%. */
export function levelColor(percent: number): 'success' | 'warning' | 'error' {
  return percent >= 80 ? 'error' : percent >= 60 ? 'warning' : 'success'
}

/** How long a finished agent stays parked on the stage before it folds into the summary. */
export const PARK_MS = 30_000

export type Lane = {
  id: string
  icon: string
  color: string
  name: string
  status: AgentNode['status']
  bubble: string
  waiting: string
  stats: string
}

export type StageView = { lanes: Lane[]; folded: { icon: string; name: string; took: string }[] }

/** The stage: Claude first, then running agents, then the ones parked under PARK_MS; the rest folded. */
export function stageView(agents: Record<string, AgentNode>, now: number, max: number): StageView {
  const all = Object.values(agents)
  const main = all.filter(n => n.id === MAIN)
  const running = all.filter(n => n.id !== MAIN && n.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
  const ended = all
    .filter(n => n.id !== MAIN && n.status !== 'running')
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const parked = ended.filter(n => now - (n.endedAt ?? now) < PARK_MS)
  const shown = [...main, ...running, ...parked].slice(0, Math.max(1, max))
  const shownIds = new Set(shown.map(n => n.id))

  return {
    lanes: shown.map(n => ({
      id: n.id,
      icon: n.icon,
      color: n.color,
      name: n.type,
      status: n.status,
      bubble: n.status === 'running' ? (n.tool ?? '') : '',
      waiting: n.status === 'running' ? (n.waiting ?? '') : '',
      stats: laneStats(n, now),
    })),
    folded: ended
      .filter(n => !shownIds.has(n.id))
      .map(n => ({ icon: n.icon, name: n.type, took: duration((n.endedAt ?? now) - n.startedAt) })),
  }
}

function laneStats(n: AgentNode, now: number): string {
  const parts = [`${shortModel(n.model)} ${n.effort ?? '–'}`, duration((n.endedAt ?? now) - n.startedAt), `🔧 ${n.tools}${n.failures ? ` ✘${n.failures}` : ''}`]
  const used = agentTokens(n)
  if (used > 0) parts.push(tokens(used))
  const rate = cacheRate(n.cacheRead ?? 0, n.tokensIn ?? 0)
  if (rate !== undefined) parts.push(`cache ${rate}%`)
  return parts.join('   ')
}
