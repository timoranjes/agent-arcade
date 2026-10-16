import { expect, test } from 'claude-code/testing'

import type { AgentNode, FeedEntry } from '../types'
import {
  FEED_CAP,
  MAIN,
  PARK_MS,
  addSample,
  addToTurn,
  addUsage,
  burnRate,
  crossedThresholds,
  describeTarget,
  finishFeed,
  mainNode,
  pushFeed,
  runningCount,
  shortModel,
  spawnAgent,
  stageView,
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

test('the burn rate projects when a window fills, and stays quiet when a reset comes first', async () => {
  let list = addSample(undefined, { at: 0, percent: 10 })
  list = addSample(list, { at: 10 * 60_000, percent: 20 })
  // 10 points per 10 minutes, 80 points left: 80 minutes.
  expect(burnRate(list, 10 * 60_000)).toBe('limit in ~1h 20m')
  expect(burnRate(list, 10 * 60_000, new Date(30 * 60_000).toISOString())).toBe('')
  // A drop means the window reset: history starts over.
  expect(addSample(list, { at: 11 * 60_000, percent: 1 })).toEqual([{ at: 11 * 60_000, percent: 1 }])
  expect(burnRate([{ at: 0, percent: 5 }], 0)).toBe('')
})

test('thresholds warn once each', async () => {
  const limits = [{ kind: 'five_hour', percentUsed: 91 }, { kind: 'seven_day', percentUsed: 40 }]
  expect(crossedThresholds(85, limits, []).map(w => w.key)).toEqual(['context', 'five_hour'])
  expect(crossedThresholds(85, limits, ['context', 'five_hour'])).toEqual([])
})

test('finished agents park on the stage, then fold into the summary', async () => {
  let agents: Record<string, AgentNode> = { [MAIN]: mainNode(0) }
  agents = spawnAgent(agents, { id: 'a', type: 'Explore', description: 'look' }, 0)
  agents = { ...agents, a: { ...agents['a']!, status: 'done', endedAt: 1000, model: 'claude-haiku-5-5', effort: 'low', tokensIn: 100, cacheRead: 300 } }

  const parked = stageView(agents, 2000, 6)
  expect(parked.lanes.map(l => l.id)).toEqual([MAIN, 'a'])
  expect(parked.lanes[1]?.stats).toContain('haiku-5-5 low')
  expect(parked.lanes[1]?.stats).toContain('cache 75%')

  const folded = stageView(agents, 1000 + PARK_MS + 1, 6)
  expect(folded.lanes.map(l => l.id)).toEqual([MAIN])
  expect(folded.folded.map(f => f.name)).toEqual(['Explore'])
})

test('usage folds into an agent and model names shorten', async () => {
  const node = mainNode(0)
  const patch = addUsage(node, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 })
  expect(patch).toEqual({ tokensIn: 20, tokensOut: 5, cacheRead: 80 })
  expect(shortModel('claude-opus-5-5')).toBe('opus-5-5')
  expect(shortModel(undefined)).toBe('–')
})
