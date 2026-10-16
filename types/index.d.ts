export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentNode = {
  id: string
  type: string
  description: string
  parentId?: string
  icon: string
  color: string
  startedAt: number
  endedAt?: number
  status: AgentStatus
  tool?: string
  tools: number
  /** Tokens its turns cost, summed from turn.complete usage. */
  tokensIn?: number
  tokensOut?: number
  cacheRead?: number
  /** The model and effort of its latest request, from turn.step. */
  model?: string
  effort?: string
  /** Tool calls that were denied or errored. */
  failures?: number
  /** Set while a permission dialog it raised has not resolved its call. */
  waiting?: string
}

/** One reading of a rate-limit window, for the burn rate. */
export type LimitSample = { at: number; percent: number }

export type FeedEntry = {
  id: string
  agentId: string
  icon: string
  color: string
  tool: string
  target: string
  ok: boolean | null
  ms?: number
}

export type TurnStats = {
  startedAt: number
  endedAt?: number
  tools: number
  files: string[]
  agents: number
  tokens?: number
  cacheRead?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-arcade': {
      agents: Record<string, AgentNode>
      feed: FeedEntry[]
      turn: TurnStats | null
      tick: number
      stageDown: boolean
      samples: Record<string, LimitSample[]>
      warned: string[]
    }
  }
}
