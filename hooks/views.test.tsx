import { expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const SITE = { scroll: { offset: 0, bodyRows: 20 }, view: {} }
const PANE = { title: 'x', isFocused: false, bodyColumns: 70, placement: 'dock' as const, ...SITE }
const NARROW = { ...PANE, bodyColumns: 44 }
const USAGE = {
  startedAt: 0,
  context: { tokens: 42_000, window: 200_000, percent: 21 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 37 },
    { kind: 'seven_day', percentUsed: 12 },
  ],
  cost: { usd: 0.12 },
}

test('the band and both panes draw on each surface, empty and after a tool call', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))

  for (const surface of SURFACES) {
    const dash = await $.ui.mount({ plugin: 'agent-arcade', surface, component: 'Pane', requestId: 'arcade-dash', props: PANE })
    expect(await dash.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
    expect(await dash.find({ type: 'Text', text: /5-hour/ })).toBeDefined()
    expect(await dash.find({ type: 'Text', text: /7-day/ })).toBeDefined()
    await dash.unmount()

    const feed = await $.ui.mount({ plugin: 'agent-arcade', surface, component: 'Pane', requestId: 'arcade-feed', props: PANE })
    expect(await feed.find({ type: 'Text', text: /Quiet in here/ })).toBeDefined()
    await feed.unmount()
  }

  await $.tool.call({ tool: 'Read', file_path: 'C:/notes/todo.md' })

  for (const surface of SURFACES) {
    const feed = await $.ui.mount({ plugin: 'agent-arcade', surface, component: 'Pane', requestId: 'arcade-feed', props: PANE })
    expect(await feed.find({ type: 'Text', text: /todo\.md/ })).toBeDefined()
    await feed.unmount()

    const band = await $.ui.mount({
      plugin: 'agent-arcade',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, ...SITE },
    })
    expect(await band.find({ type: 'Text', text: /arcade/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /opus-5-5/ })).toBeDefined()
    await band.unmount()
  }
})

test('a turn puts Claude on the animated stage with the model and effort it is sent with', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'xhigh', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }

  const dash = await $.ui.mount({ plugin: 'agent-arcade', surface: 'terminal', component: 'Pane', requestId: 'arcade-dash', props: PANE })
  await dash.resize({ columns: 70, rows: 4 })
  expect(await dash.find({ in: 'stage', type: 'Text', text: /sonnet-5-5 xhigh/ })).toBeDefined()
  const row = async () => (await dash.find({ in: 'stage', type: 'Text', text: /Claude.*┆/ }))?.text
  const before = await row()
  expect(before).toBeDefined()
  await dash.advance(1000) // the stage runs on its own frame clock: the sprite has moved
  const after = await row()
  expect(after).toBeDefined()
  expect(after === before).toBe(false)
  await dash.unmount()

  // Narrow: one line of usage.
  const narrow = await $.ui.mount({ plugin: 'agent-arcade', surface: 'desktop', component: 'Pane', requestId: 'arcade-dash', props: NARROW })
  expect(await narrow.find({ type: 'Text', text: /ctx 21%/ })).toBeDefined()
  await narrow.unmount()
})
