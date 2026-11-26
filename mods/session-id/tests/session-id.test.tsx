import { expect, test } from 'claude-code/testing'

const ID = 'dc54fc3b-0272-4cba-b9cc-d71a00a62d46'

const RUN_SID = {
  command: 'sid',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const CELL = {
  plugin: 'session-id',
  component: 'BesidePrompt',
  props: { maxColumns: 40, floatRows: 0, floatColumns: 40, isWorking: false, view: {} },
} as const

test('the short id stands beside the prompt, on terminal and desktop', async ($, on) => {
  on('session.id', () => ({ value: ID }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...CELL, surface })
    expect((await ui.find({ type: 'Text', text: /sid/ }))?.text).toBe('sid dc54fc3b')
    await ui.unmount()
  }
})

test('with no room the cell is left to the engine', async ($, on) => {
  on('session.id', () => ({ value: ID }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...CELL, surface: 'terminal', props: { ...CELL.props, maxColumns: 4 } })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('/sid copies the full id and says how to use it', async ($, on) => {
  const copied: string[] = []
  on('session.id', () => ({ value: ID }))
  on('command.register', () => ({ value: { command: 'sid' } }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run(RUN_SID)

  expect(copied).toEqual([ID])
  expect(text).toContain(`세션 ID를 복사했어요: ${ID}`)
  expect(text).toContain('전해 줘')
})

test('/sid still shows the id when the clipboard refuses', async ($, on) => {
  on('session.id', () => ({ value: ID }))
  on('command.register', () => ({ value: { command: 'sid' } }))
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run(RUN_SID)

  expect(text).toContain(`세션 ID: ${ID}`)
  expect(text).toContain('no-clipboard')
})
