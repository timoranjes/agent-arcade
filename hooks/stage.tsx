import type { ClientModule, JsonValue } from 'claude-code'

import type { Lane } from './model'

// The stage: one lane per agent, its sprite running while it works.
// Runs on the surface's own frame clock, so it never waits on the hooks module.

export type StageProps = { lanes: Lane[] }

type Shared = { props: StageProps; end: number }
type StageState = { box: Shared; pos: Record<string, number>; dir: Record<string, number>; frame: number }

const FRAME_MS = 120
const LABEL = 13
const SPRITE = 2 // an emoji takes two cells

function seed(id: string, end: number): number {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return end > 0 ? hash % end : 0
}

function cells(text: string): number {
  return [...text].length
}

function clip(text: string, room: number): string {
  if (room <= 0) return ''
  const chars = [...text]
  return chars.length <= room ? text : `${chars.slice(0, Math.max(0, room - 1)).join('')}…`
}

function startAt(lane: Lane, end: number): number {
  if (lane.status === 'running') return seed(lane.id, end)
  return lane.id === 'main' ? 0 : end
}

/** One frame on: moves what moves; `moved` false when nothing did, so an idle stage costs no redraw. */
export function step(state: StageState): { next: StageState; moved: boolean } {
  const { lanes } = state.box.props
  const end = state.box.end
  const pos: Record<string, number> = {}
  const dir: Record<string, number> = {}
  let moved = Object.keys(state.pos).length !== lanes.length

  for (const lane of lanes) {
    const was = state.pos[lane.id] ?? startAt(lane, end)
    let p = Math.min(was, end)
    let d = state.dir[lane.id] ?? 1
    const isMainAsleep = lane.id === 'main' && lane.status !== 'running'
    if (lane.status === 'running' && !lane.waiting) {
      // Each lane keeps its own pace: a slow one moves every other frame.
      const isSlow = seed(lane.id, 2) === 1
      if (!isSlow || state.frame % 2 === 0) {
        if (p + d > end || p + d < 0) d = -d
        p += d
      }
    } else if (isMainAsleep && p > 0) {
      p = Math.max(0, p - 2)
      d = -1
    } else if (lane.status === 'done' && !isMainAsleep && p < end) {
      p = Math.min(end, p + 2)
      d = 1
    }
    pos[lane.id] = p
    dir[lane.id] = d
    if (p !== was || d !== state.dir[lane.id]) moved = true
  }

  return { next: { box: state.box, pos, dir, frame: state.frame + 1 }, moved }
}

type Seg = { at: number; text: string; width: number; color?: string; dim?: boolean }

/** The track's segments left to right; the gaps between are spaces. */
export function trackSegments(lane: Lane, p: number, d: number, track: number): Seg[] {
  const isMoving = lane.status === 'running' && !lane.waiting
  const isMainAsleep = lane.id === 'main' && lane.status !== 'running'
  const sprite = lane.status === 'failed' ? '💥' : isMainAsleep ? '💤' : lane.icon
  const segs: Seg[] = [{ at: p, text: sprite, width: SPRITE }]
  let right = p + SPRITE
  let left = p

  if (isMoving && d > 0 && p >= 2) {
    segs.unshift({ at: p - 2, text: '·∙', width: 2, dim: true })
    left = p - 2
  }
  if (isMoving && d < 0 && right + 2 <= track) {
    segs.push({ at: right, text: '∙·', width: 2, dim: true })
    right += 2
  }

  const words = lane.waiting ? `⏸ asked you to approve ${lane.waiting}` : lane.bubble
  if (words) {
    const bubble = `⟨${words}⟩`
    const color = lane.waiting ? 'warning' : undefined
    const roomRight = track - right - 1
    const roomLeft = left - 1
    if (cells(bubble) <= roomRight || roomRight >= roomLeft) {
      const text = clip(bubble, roomRight)
      if (roomRight >= 6) segs.push({ at: right + 1, text, width: cells(text), color, dim: !color })
    } else if (roomLeft >= 6) {
      const text = clip(bubble, roomLeft)
      segs.unshift({ at: left - 1 - cells(text), text, width: cells(text), color, dim: !color })
    }
  }

  return segs
}

const Stage: ClientModule<JsonValue, StageState> = (raw, surface) => {
  const { Box, Text } = surface.elements
  const props = raw as unknown as StageProps
  const width = Math.max(24, surface.columns || 60)
  const track = Math.max(10, width - LABEL - 2)
  const end = track - SPRITE

  let now = surface.state
  if (now === undefined) {
    // First draw: one setState, and the one timer. The timer steps from its own
    // copy (several ticks can pass between redraws) and hands each frame over
    // as a new object, which is what makes the surface draw again.
    let cur: StageState = { box: { props, end }, pos: {}, dir: {}, frame: 0 }
    now = cur
    surface.setState(cur)
    surface.every(FRAME_MS, () => {
      const { next, moved } = step(cur)
      cur = next
      if (moved) surface.setState(next)
    })
  }
  // New props and width reach the running timer through the box every frame shares.
  now.box.props = props
  now.box.end = end
  const state = now

  return Box({
    flexDirection: 'column',
    children: props.lanes.map(lane => {
      const p = Math.min(state.pos[lane.id] ?? startAt(lane, end), end)
      const segs = trackSegments(lane, p, state.dir[lane.id] ?? 1, track)
      const parts = []
      let at = 0
      for (const seg of segs) {
        if (seg.at > at) parts.push(Text({ children: ' '.repeat(seg.at - at) }))
        parts.push(Text({ children: seg.text, color: seg.color, dimColor: seg.dim }))
        at = Math.max(at, seg.at) + seg.width
      }
      if (track > at) parts.push(Text({ children: ' '.repeat(track - at) }))
      const isFinished = lane.status === 'done' && lane.id !== 'main'
      const name = clip(lane.name, LABEL - 4).padEnd(LABEL - 4)

      return Box({
        key: lane.id,
        flexDirection: 'column',
        children: [
          Text({
            wrap: 'truncate-end',
            children: [
              Text({ children: `${lane.icon} ` }),
              Text({ children: `${name} `, color: lane.color, weight: 'bold' }),
              Text({ children: '┆', dimColor: true }),
              ...parts,
              isFinished ? Text({ children: '✔', color: 'success' }) : Text({ children: '┆', dimColor: true }),
            ],
          }),
          Text({ wrap: 'truncate-end', dimColor: true, children: `${' '.repeat(LABEL + 1)}${lane.stats}` }),
        ],
      })
    }),
  })
}

export default Stage
