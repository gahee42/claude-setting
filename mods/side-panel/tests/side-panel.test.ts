import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { asText, findOwnScript, isSessionTerminal, settleTasks, sideCommand, splitScript, trackShell } from '../hooks/side'

const ID = 'dc54fc3b-0272-4cba-b9cc-d71a00a62d46'

const RUN_SIDE = {
  command: 'side',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 140 },
} as const

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

type Machine = {
  env?: Record<string, string>
  tty?: string // what the tty lookup prints; '' fails it
  columns?: number
  own?: string // the terminal the title marker finds
  focused?: string // `id, working directory` of Ghostty's focused terminal
  made?: string // the split's new terminal id
}

/** The engine and the machine beneath: a session in /work, HOME=/Users/me; what was run, written, copied. */
function world(on: On, m: Machine) {
  const files: Record<string, string> = {}
  const splits: string[] = []
  const copied: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/me', PATH: '/opt/homebrew/bin:/usr/bin', TERM_PROGRAM: 'ghostty', ...m.env })
  on('session.id', () => ({ value: ID }))
  on('session.info', () => ({ value: { transcriptPath: '/t.jsonl' } }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work/.claude/worktrees/a' }))
  on('agent.list', () => ({ value: [] as AgentInfo[] }))
  on('command.register', () => ({ value: { command: 'side' } }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('process.run', (_, e) => {
    const [cmd = '', , arg = ''] = e.argv
    let out: string | null = null
    if (cmd === '/bin/sh') out = m.tty ?? 'ttys003'
    else if (cmd === 'stty') out = `61 ${m.columns ?? 140}`
    else if (arg.includes('whose name is marker')) out = m.own ?? 'T1'
    else if (arg.includes('focused terminal')) out = m.focused ?? ''
    else if (arg.includes('split t direction left')) {
      splits.push(arg)
      out = m.made ?? 'NEW'
    }
    const ok = out !== null && out !== ''
    return { value: { exitCode: ok ? 0 : 1, stdout: ok ? `${out}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { files, splits, copied, clock }
}

const lastFeed = (files: Record<string, string>) => JSON.parse(Object.values(files).at(-1) ?? '{}') as Record<string, unknown>

test('AppleScript text is quoted; the split goes left, waits for nothing and gives the keys back', () => {
  expect(asText('a "b" \\c')).toBe('"a \\"b\\" \\\\c"')
  const script = splitScript('T1', 'python3 "/Users/me/.claude/side.py" k', ['PATH=/bin'], '/Users/me')
  expect(script).toContain('set t to terminal id "T1"')
  expect(script).toContain('split t direction left with configuration cfg')
  expect(script).toContain('set command of cfg to "python3 \\"/Users/me/.claude/side.py\\" k"')
  expect(script).toContain('set wait after command of cfg to false')
  expect(script).toContain('focus t')
  expect(sideCommand('/Users/me', 'k')).toBe('python3 "/Users/me/.claude/side.py" k')
})

test("the terminal finder titles this session's tty, asks Ghostty for that title, and puts the title back", () => {
  const script = findOwnScript('ttys003', 'claude-side-x')
  expect(script).toContain('set marker to "claude-side-x"')
  expect(script).toContain(`do shell script "printf '\\\\033]2;%s\\\\007' " & quoted form of marker & " > /dev/ttys003"`)
  expect(script).toContain('id of every terminal whose name is marker')
  expect(script).toContain('quoted form of oldName & " > /dev/ttys003"')
})

test('the focused terminal is this session only where it started, or above its worktree', () => {
  expect(isSessionTerminal('/work', '/work', '/work')).toBe(true)
  expect(isSessionTerminal('/work/', '/elsewhere', '/work/.claude/worktrees/a')).toBe(true)
  expect(isSessionTerminal('/other', '/work', '/work')).toBe(false)
  expect(isSessionTerminal('/wo', '/work', '/work/x')).toBe(false)
  expect(isSessionTerminal('', '/work', '/work')).toBe(false)
})

test('shells run until they leave the in-flight list; subagents stay out', () => {
  let list = trackShell([], { id: 'b1', label: 'yarn test' })
  list = settleTasks(list, [
    { id: 'm1', type: 'monitor', description: 'CI 지켜보기' },
    { id: 's1', type: 'subagent', description: '찾기' },
  ])
  expect(list).toEqual([
    { id: 'b1', label: 'yarn test', isRunning: false },
    { id: 'm1', label: 'CI 지켜보기', isRunning: true },
  ])
})

test('in Ghostty the panel opens by itself as the session starts, left of its own terminal', async ($, on) => {
  const { files, splits, copied, clock } = world(on, {})
  await $.session.start(START)
  expect(splits).toEqual([])

  await clock.advance(1_500)
  expect(splits.length).toBe(1)
  expect(splits[0]).toContain('set t to terminal id "T1"')
  expect(splits[0]).toContain('"PATH=/opt/homebrew/bin:/usr/bin"')
  expect(copied).toEqual([])
  expect(lastFeed(files)).toMatchObject({ sessionId: ID, transcript: '/t.jsonl', termId: 'NEW', agents: [], tasks: [] })
})

test('it does not open by itself in a narrow terminal, and writes no feed', async ($, on) => {
  const { splits, files, clock } = world(on, { columns: 100 })
  await $.session.start(START)
  await clock.advance(1_500)
  expect(splits).toEqual([])
  expect(files).toEqual({})
})

test('outside Ghostty nothing opens by itself', async ($, on) => {
  const { splits, files, clock } = world(on, { env: { TERM_PROGRAM: 'iTerm.app' } })
  await $.session.start(START)
  await clock.advance(1_500)
  expect(splits).toEqual([])
  expect(files).toEqual({})
})

test('with autoOpen off nothing opens by itself', { options: { autoOpen: false } }, async ($, on) => {
  const { splits, clock } = world(on, {})
  await $.session.start(START)
  await clock.advance(1_500)
  expect(splits).toEqual([])
})

test('/side closes the open panel, and a reload does not open it again until /side', async ($, on) => {
  const { files, splits, clock } = world(on, {})
  await $.session.start(START)
  await clock.advance(1_500)
  expect(splits.length).toBe(1)

  const { text } = await $.command.run(RUN_SIDE)
  expect(text).toContain('닫았어요')
  expect(lastFeed(files)).toMatchObject({ closed: true })

  await $.session.start(START) // what /reload-plugins runs again
  await clock.advance(1_500)
  expect(splits.length).toBe(1)

  expect((await $.command.run(RUN_SIDE)).text).toBe('왼쪽에 세션 패널을 열었어요. /side 로 닫아요.')
  expect(splits.length).toBe(2)
})

test('when the tty lookup fails, a typed /side splits the focused terminal only if it is this session', async ($, on) => {
  const { splits } = world(on, { tty: '', focused: 'F1, /work' })
  await $.session.start(START)
  await $.command.run(RUN_SIDE)
  expect(splits[0]).toContain('set t to terminal id "F1"')
})

test('when the focused terminal is another one, /side copies the command instead', async ($, on) => {
  const { splits, copied } = world(on, { tty: '', focused: 'F9, /somewhere/else' })
  await $.session.start(START)
  const { text } = await $.command.run(RUN_SIDE)
  expect(splits).toEqual([])
  expect(copied[0]).toMatch(/^python3 "\/Users\/me\/\.claude\/side\.py" [\w-]+$/)
  expect(text).toContain('복사했어요')
})
