import type { AgentInfo } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { agentRows, parseInfo, prMark, settleTasks, trackShell } from '../hooks/panel'

const ID = 'dc54fc3b-0272-4cba-b9cc-d71a00a62d46'
const PR = 'https://github.com/gahee42/claude-setting/pull/5'

const PANE = {
  plugin: 'side-panel',
  component: 'Pane',
  requestId: 'side',
  props: {
    title: '세션',
    isFocused: false,
    bodyColumns: 30,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUN_SIDE = {
  command: 'side',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 140 },
} as const

test('statusline --panel output is read, anything else is not', () => {
  expect(parseInfo('{"title":"정산","prs":[{"url":"u","num":5,"state":"OPEN","draft":false,"ci":"pass"}]}')).toEqual({
    title: '정산',
    prs: [{ url: 'u', num: 5, state: 'OPEN', draft: false, ci: 'pass' }],
  })
  expect(parseInfo('statusline error')).toBeNull()
  expect(parseInfo('{"title":"x"}')).toBeNull()
})

test('running agents come first, then the latest of the rest', () => {
  const rows = agentRows([
    { id: 'a', type: 'Explore', description: '찾기', status: 'completed' },
    { id: 'b', type: 'Plan', description: '설계', status: 'running' },
    { id: 'c', type: 'Explore', description: '다시', status: 'failed', name: 'again' },
  ])
  expect(rows.map(r => r.id)).toEqual(['b', 'c', 'a'])
  expect(rows[1]?.label).toBe('again')
})

test('a shell runs until it leaves the in-flight list; subagents stay out', () => {
  let list = trackShell([], { id: 'b1', label: 'yarn test' })
  expect(list).toEqual([{ id: 'b1', label: 'yarn test', isRunning: true }])

  list = settleTasks(list, [
    { id: 'm1', type: 'monitor', description: 'CI 지켜보기' },
    { id: 's1', type: 'subagent', description: '찾기' },
  ])
  expect(list).toEqual([
    { id: 'b1', label: 'yarn test', isRunning: false },
    { id: 'm1', label: 'CI 지켜보기', isRunning: true },
  ])
})

test('only the last three ended tasks are kept', () => {
  let list = ['1', '2', '3', '4', '5'].reduce((l, id) => trackShell(l, { id, label: id }), [] as ReturnType<typeof trackShell>)
  list = settleTasks(list, [{ id: '5', type: 'shell', description: '5' }])
  expect(list.map(t => t.id)).toEqual(['2', '3', '4', '5'])
})

test('a PR shows CI or how it ended', () => {
  const pr = { url: PR, num: 5, state: 'OPEN', draft: false, ci: 'pass' }
  expect(prMark(pr)).toEqual({ text: '✓', color: 'success' })
  expect(prMark({ ...pr, state: 'MERGED' }).text).toBe('merged')
  expect(prMark({ ...pr, draft: true, ci: '' }).text).toBe('draft')
})

test('/side opens the panel and fills it: title, sid, PR, agents', async ($, on) => {
  const opened: string[] = []
  let isOpen = false
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/Users/me' })
  on('session.id', () => ({ value: ID }))
  on('session.info', () => ({ value: { transcriptPath: '/t.jsonl' } }))
  on('command.register', () => ({ value: { command: 'side' } }))
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'side', title: '세션', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('agent.list', () => ({
    // only the fields the panel reads
    value: [{ id: 'a1', type: 'Explore', description: '정산 코드 찾기', status: 'running' }] as unknown as AgentInfo[],
  }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: e.argv[1] === '/Users/me/.claude/statusline.py' && e.argv[3] === ID ? 0 : 1,
      stdout: JSON.stringify({ title: '정산서 차감내역', prs: [{ url: PR, num: 5, state: 'OPEN', draft: false, ci: 'pass' }] }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run(RUN_SIDE)
  expect(text).toBe('세션 패널을 열었어요.')
  expect(opened).toEqual(['side'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /정산서/ }))?.text).toBe('정산서 차감내역')
  expect((await ui.find({ type: 'Button', key: 'sid' }))?.text).toContain('sid dc54fc3b')
  expect((await ui.find({ type: 'Link' }))?.text).toContain('#5')
  expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toContain('정산 코드 찾기')
  await ui.unmount()
})

test('/side on an open panel closes it and keeps it closed', async ($, on) => {
  const closed: string[] = []
  const stored: Record<string, unknown> = {}
  mock.clock(on)
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'side' } }))
  on('ui.panes', () => ({ value: [{ id: 'side', title: '세션', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run(RUN_SIDE)
  expect(text).toContain('닫았어요')
  expect(closed).toEqual(['side'])
  expect(stored).toEqual({ hidden: true })
})

test('a background shell shows in the panel', async ($, on) => {
  on('session.id', () => ({ value: ID }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))

  await $.tool.call({ tool: 'Bash', command: 'yarn test:default', description: '테스트 돌리기', run_in_background: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /테스트 돌리기/ }))?.text).toContain('●')
  await ui.unmount()
})
