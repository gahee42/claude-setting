import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { asText, isSessionTerminal, settleTasks, sideCommand, splitScript, trackShell } from '../hooks/side'

const ID = 'dc54fc3b-0272-4cba-b9cc-d71a00a62d46'

const RUN_SIDE = {
  command: 'side',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 140 },
} as const

type Run = { argv: readonly string[] }

/** The engine beneath: a session in /work, HOME=/Users/me, and what each call wrote, ran or copied. */
function world(on: On, env: Record<string, string>, osascript: (script: string) => string) {
  const files: Record<string, string> = {}
  const ran: string[] = []
  const copied: string[] = []
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/me', PATH: '/opt/homebrew/bin:/usr/bin', ...env })
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
  on('process.run', (_, e: Run) => {
    const script = e.argv[2] ?? ''
    ran.push(script)
    return { value: { exitCode: 0, stdout: osascript(script), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { files, ran, copied }
}

const feedOf = (files: Record<string, string>) => {
  const [path, text] = Object.entries(files).at(-1) ?? ['', '{}']
  return { path, feed: JSON.parse(text) as Record<string, unknown> }
}

test('AppleScript text is quoted, and the split goes left and gives the keys back', () => {
  expect(asText('a "b" \\c')).toBe('"a \\"b\\" \\\\c"')
  const script = splitScript('T1', 'python3 "/Users/me/.claude/side.py" k', ['PATH=/bin'], '/Users/me')
  expect(script).toContain('set t to terminal id "T1"')
  expect(script).toContain('split t direction left with configuration cfg')
  expect(script).toContain('set command of cfg to "python3 \\"/Users/me/.claude/side.py\\" k"')
  expect(script).toContain('set wait after command of cfg to false')
  expect(script).toContain('focus t')
  expect(sideCommand('/Users/me', 'k')).toBe('python3 "/Users/me/.claude/side.py" k')
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

test('in Ghostty /side splits this terminal to the left and feeds it', async ($, on) => {
  const { files, ran, copied } = world(on, { TERM_PROGRAM: 'ghostty' }, script =>
    script.includes('focused terminal') ? 'T1, /work\n' : 'NEW\n',
  )
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const { text } = await $.command.run(RUN_SIDE)
  expect(text).toBe('왼쪽에 세션 패널을 열었어요. /side 로 닫아요.')
  expect(ran.length).toBe(2)
  expect(ran[1]).toContain('set t to terminal id "T1"')
  expect(ran[1]).toContain('"PATH=/opt/homebrew/bin:/usr/bin"')
  expect(copied).toEqual([])

  const { path, feed } = feedOf(files)
  expect(path).toMatch(/^\/Users\/me\/\.claude\/side\/[\w-]+\.json$/)
  expect(feed).toMatchObject({ sessionId: ID, transcript: '/t.jsonl', termId: 'NEW', agents: [], tasks: [] })
})

test('when the focused terminal is another one, /side copies the command instead', async ($, on) => {
  const { ran, copied } = world(on, { TERM_PROGRAM: 'ghostty' }, () => 'T9, /somewhere/else\n')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const { text } = await $.command.run(RUN_SIDE)
  expect(ran.length).toBe(1)
  expect(copied.length).toBe(1)
  expect(copied[0]).toMatch(/^python3 "\/Users\/me\/\.claude\/side\.py" [\w-]+$/)
  expect(text).toContain('복사했어요')
})

test('outside Ghostty /side copies the command, and /side again closes the panel', async ($, on) => {
  const { files, ran, copied } = world(on, { TERM_PROGRAM: 'iTerm.app' }, () => '')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  await $.command.run(RUN_SIDE)
  expect(ran).toEqual([])
  expect(copied.length).toBe(1)

  const { text } = await $.command.run(RUN_SIDE)
  expect(text).toBe('세션 패널을 닫았어요.')
  expect(feedOf(files).feed).toMatchObject({ closed: true })
})
