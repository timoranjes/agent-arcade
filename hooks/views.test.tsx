import { expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const SITE = { scroll: { offset: 0, bodyRows: 20 }, view: {} }
const PANE = { title: 'x', isFocused: false, bodyColumns: 60, placement: 'dock' as const, ...SITE }

test('the band and both panes draw on each surface, empty and after a tool call', async ($, on) => {
  mock.clock(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 42_000, window: 200_000, percent: 21 }, rateLimits: [], cost: { usd: 0.12 } } }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))

  for (const surface of SURFACES) {
    const tree = await $.ui.mount({ plugin: 'agent-arcade', surface, component: 'Pane', requestId: 'arcade-tree', props: PANE })
    expect(await tree.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
    await tree.unmount()

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
    await band.unmount()
  }
})
