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
}

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
}

declare module 'claude-code' {
  interface PluginState {
    'agent-arcade': {
      agents: Record<string, AgentNode>
      feed: FeedEntry[]
      turn: TurnStats | null
      tick: number
    }
  }
}
