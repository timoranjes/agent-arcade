import { expect, test } from 'claude-code/testing'

import type { Lane } from './model'
import { step, trackSegments } from './stage'

const lane = (over: Partial<Lane>): Lane => ({
  id: 'x', icon: '🔭', color: 'cyan', name: 'Explore', status: 'running', bubble: '', waiting: '', stats: '', ...over,
})

const state = (lanes: Lane[], pos: Record<string, number>, end = 20) => ({
  box: { props: { lanes }, end }, pos, dir: Object.fromEntries(Object.keys(pos).map(k => [k, 1])), frame: 0,
})

test('a running sprite moves and turns at the end of its track', async () => {
  const { next } = step(state([lane({ id: 'a' })], { a: 20 }))
  expect(next.pos['a']).toBe(19)
  expect(next.dir['a']).toBe(-1)
})

test('a waiting or failed sprite stands still, and an idle stage asks no redraw', async () => {
  expect(step(state([lane({ id: 'a', waiting: 'Bash npm test' })], { a: 5 })).moved).toBe(false)
  expect(step(state([lane({ id: 'b', status: 'failed' })], { b: 5 })).moved).toBe(false)
})

test('a finished agent runs to the finish; Claude goes back to sleep at the start', async () => {
  expect(step(state([lane({ id: 'a', status: 'done' })], { a: 10 })).next.pos['a']).toBe(12)
  expect(step(state([lane({ id: 'main', status: 'done' })], { main: 10 })).next.pos['main']).toBe(8)
})

test('the bubble follows the sprite, and a wait shows what it asked', async () => {
  const segs = trackSegments(lane({ bubble: 'Grep "usage"' }), 4, 1, 40)
  expect(segs.map(s => s.text)).toEqual(['·∙', '🔭', '⟨Grep "usage"⟩'])
  const waiting = trackSegments(lane({ waiting: 'Bash npm test' }), 0, 1, 50)
  expect(waiting[1]?.text).toContain('asked you to approve Bash npm test')
})

test('a slow lane keeps moving on its own: the frame advances even when nothing moved', async () => {
  // 'main' is a slow lane: it moves on even frames only.
  let s = state([lane({ id: 'main' })], { main: 5 })
  const start = s.pos['main']
  for (let i = 0; i < 6; i++) s = step(s).next
  expect(s.frame).toBe(6)
  expect(Math.abs((s.pos['main'] ?? 0) - (start ?? 0))).toBe(3)
})
