import type { AgentNode, FeedEntry, TurnStats } from '../types'

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
