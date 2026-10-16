import { expect, test } from 'claude-code/testing'

import type { AgentNode, FeedEntry } from '../types'
import {
  FEED_CAP,
  MAIN,
  addToTurn,
  describeTarget,
  finishFeed,
  mainNode,
  pushFeed,
  runningCount,
  spawnAgent,
  treeOrder,
} from './model'

test('spawned agents nest under their parent in tree order', async () => {
  let agents: Record<string, AgentNode> = { [MAIN]: mainNode(0) }
  agents = spawnAgent(agents, { id: 'a', type: 'Explore', description: 'look' }, 10)
  agents = spawnAgent(agents, { id: 'b', type: 'Plan', description: 'plan', parentId: 'a' }, 20)
  agents = spawnAgent(agents, { id: 'c', type: 'custom', description: 'x' }, 30)

  const order = treeOrder(agents).map(r => `${r.node.id}:${r.depth}`)
  expect(order).toEqual(['main:0', 'a:1', 'b:2', 'c:1'])
  expect(agents['a']?.icon).toBe('🔭')
  expect(runningCount(agents)).toBe(3)
})

test('the feed keeps only the newest entries and marks finished calls', async () => {
  let feed: FeedEntry[] = []
  for (let i = 0; i < FEED_CAP + 5; i += 1) {
    feed = pushFeed(feed, { id: `c${i}`, agentId: MAIN, icon: '🧠', color: 'claude', tool: 'Read', target: '', ok: null })
  }
  expect(feed.length).toBe(FEED_CAP)
  expect(feed[0]?.id).toBe('c5')

  feed = finishFeed(feed, 'c9', false, 120)
  expect(feed.find(f => f.id === 'c9')).toMatchObject({ ok: false, ms: 120 })
})

test('turn stats count tools and unique edited files', async () => {
  let turn = addToTurn({ startedAt: 0, tools: 0, files: [], agents: 0 }, 'Edit', 'a.ts')
  turn = addToTurn(turn, 'Edit', 'a.ts')
  turn = addToTurn(turn, 'Read', 'b.ts')
  expect(turn).toMatchObject({ tools: 3, files: ['a.ts'] })
})

test('targets read well for common tools', async () => {
  expect(describeTarget({ file_path: 'C:\\x\\y\\notes.md' })).toBe('notes.md')
  expect(describeTarget({ pattern: 'agentId' })).toBe('"agentId"')
  expect(describeTarget({ command: 'git   status' })).toBe('git status')
  expect(describeTarget({})).toBe('')
})
