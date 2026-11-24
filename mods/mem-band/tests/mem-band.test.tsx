import { expect, test } from 'claude-code/testing'

import { parseLevel, toPattern } from '../hooks/memory'

const BAND = {
  plugin: 'mem-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 1,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 1 },
    view: {},
  },
} as const

test('parseLevel reads sysctl output', async () => {
  expect(parseLevel('73\n')).toBe(73)
  expect(parseLevel('')).toBeNull()
  expect(parseLevel('sysctl: unknown oid')).toBeNull()
})

test('the default heavy pattern matches browser tests and builds only', async () => {
  const heavy = toPattern('vitest[^;&|]*--browser|playwright\\s+test|docker\\s+(?:build|compose\\s+up)|next\\s+build')
  expect(heavy?.test('pnpm vitest run --browser')).toBe(true)
  expect(heavy?.test('docker build -t app .')).toBe(true)
  expect(heavy?.test('pnpm vitest run')).toBe(false)
  expect(heavy?.test('git status')).toBe(false)
  expect(toPattern('(')).toBeUndefined()
})

test('low memory draws a row above the prompt, on every surface', async ($, on) => {
  on('state.get', () => ({ value: { value: 9, version: 1 } }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /메모리 여유 9%/ }))?.text).toContain('물어봐요')
    await ui.unmount()
  }
})

test('plenty of memory leaves the row to the engine', async ($, on) => {
  on('state.get', () => ({ value: { value: 73, version: 1 } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
