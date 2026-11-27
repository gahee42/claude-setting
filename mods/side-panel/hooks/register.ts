// side-panel
// A tall column of this session's info LEFT of Claude Code, top to bottom: title, session id,
// artifacts, PRs, agents, background shells. Claude Code docks a mod's pane on the right only, so
// the column is a terminal split. In Ghostty it opens by itself as a session starts (autoOpen),
// or with /side: AppleScript splits this session's terminal, found by its tty, and hands the keys
// back to Claude Code. Elsewhere /side copies the command to paste into a split.
// The split runs ~/.claude/side.py (claude/side.py in this repo), which reads the feed this
// mod writes every two seconds, ~/.claude/side/<key>.json, and touches <key>.alive while it
// runs. /side again, or the session's end, closes it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Open } from '../types'
import {
  agentRows,
  findOwnScript,
  FOCUSED_SCRIPT,
  isSessionTerminal,
  settleTasks,
  sideCommand,
  splitScript,
  trackShell,
  TTY_SH,
} from './side'

const FEED_MS = 2_000
const GONE_MS = 15_000 // side.py's heartbeat stopped this long ago: the split was closed by hand
const WAIT_MS = 5 * 60_000 // a pasted command that never started
const AUTO_DELAY_MS = 1_500 // let Claude Code draw its first frame before the terminal narrows
const MIN_COLUMNS = 110 // opened by itself only where Claude Code keeps 76 columns beside it

// Change a tag when that value's fields change: a reload declines what an earlier version stored.
const open = atom({ plugin: 'side-panel', key: 'open' } as const, null, { shape: 'open-1' })
const tasks = atom({ plugin: 'side-panel', key: 'tasks' } as const, [], { shape: 'tasks-1' })
// The person closed it (/side, or by hand): a reload or /clear doesn't open it again; /side does.
const dismissed = atom({ plugin: 'side-panel', key: 'dismissed' } as const, false)

type Extra = { ended?: true; closed?: true }

// /clear ends the session and starts the next without a session.start; the panel follows it.
let carried: Open | null = null

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'side', description: '왼쪽에 세로로 긴 세션 패널을 열거나 닫는다' })
    $.clock.every(FEED_MS, () => {
      void tick($)
    })
    if (autoOpen && e.isInteractive && e.surface === 'terminal') {
      $.clock.after(AUTO_DELAY_MS, () => {
        void openByItself($)
      })
    }
    return started
  })

  on('command.run', { command: 'side' }, async ($, e) => {
    const home = await $.env.get('HOME')
    if (!home) return { text: 'HOME 을 몰라서 패널을 열 수 없어요.' }

    const current = await read($, open)
    if (current) {
      await writeFeed($, home, current, { closed: true })
      await update($, open, () => null)
      await update($, dismissed, () => true)
      return { text: '세션 패널을 닫았어요. /side 로 다시 열어요.' }
    }
    await update($, dismissed, () => false)

    const opened = await openPanel($, home, { isPerson: e.origin.kind === 'composer', minColumns: 0, canCopy: true })
    if (!opened) return { text: '패널을 열지 못했어요.' }
    if (opened.termId) return { text: '왼쪽에 세션 패널을 열었어요. /side 로 닫아요.' }
    const command = sideCommand(home, opened.key)
    const copied = await $.ui.copy({ text: command })
    const how = '터미널을 왼쪽으로 나눈 창에서 실행하세요'
    return { text: copied.isCopied ? `패널 명령을 복사했어요. ${how}:\n${command}` : `${how}:\n${command}` }
  })

  on('session.end', async ($, e, next) => {
    const current = await read($, open)
    if (current && e.reason === 'clear') carried = current
    else if (current) {
      const home = await $.env.get('HOME')
      if (home) await writeFeed($, home, current, { ended: true })
      await update($, open, () => null)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const out = 'result' in ran && !ran.isError ? (ran.result as { backgroundTaskId?: string }) : undefined
    if (out?.backgroundTaskId) {
      const shell = { id: out.backgroundTaskId, label: e.description || e.command || 'shell' }
      await update($, tasks, list => trackShell(list, shell))
    }
    return ran
  })

  on('classic.Stop', async ($, e, next) => {
    const inFlight = e.background_tasks ?? []
    await update($, tasks, list => settleTasks(list, inFlight))
    return next(e)
  })
}

async function tick($: EngineInterface): Promise<void> {
  let current = await read($, open)
  if (!current && carried) {
    current = carried
    carried = null
    const restored = current
    await update($, open, () => restored)
  }
  if (!current) return
  const home = await $.env.get('HOME')
  if (!home) return

  const now = await $.clock.now()
  const alive = `${home}/.claude/side/${current.key}.alive`
  const seen = (await $.fs.exists(alive)) ? (await $.fs.stat(alive)).mtimeMs : 0
  if ((seen && now - seen > GONE_MS) || (!seen && now - current.openedAt > WAIT_MS)) {
    await update($, open, () => null)
    if (seen) await update($, dismissed, () => true)
    return
  }
  await writeFeed($, home, current)
}

async function writeFeed($: EngineInterface, home: string, current: Open, extra: Extra = {}): Promise<void> {
  const { transcriptPath } = await $.session.info()
  const feed = {
    key: current.key,
    sessionId: await $.session.id(),
    transcript: transcriptPath,
    termId: current.termId,
    at: await $.clock.now(),
    agents: agentRows(await $.agent.list()),
    tasks: await read($, tasks),
    ...extra,
  }
  await $.fs.write(`${home}/.claude/side/${current.key}.json`, JSON.stringify(feed))
}

/** As a session starts, in Ghostty, wide enough, and not closed by the person earlier. */
async function openByItself($: EngineInterface): Promise<void> {
  if ((await read($, open)) || (await read($, dismissed))) return
  if ((await $.env.get('TERM_PROGRAM')) !== 'ghostty') return
  const home = await $.env.get('HOME')
  if (!home) return
  await openPanel($, home, { isPerson: false, minColumns: MIN_COLUMNS, canCopy: false })
}

/**
 * In Ghostty, splits this session's terminal to the left running side.py, and starts its feed.
 * Where no split can be made: with `canCopy` the feed starts for a command the caller copies
 * (`termId` ''), else nothing happens (null).
 */
async function openPanel(
  $: EngineInterface,
  home: string,
  how: { isPerson: boolean; minColumns: number; canCopy: boolean },
): Promise<Open | null> {
  let target = ''
  if ((await $.env.get('TERM_PROGRAM')) === 'ghostty') {
    const own = await ownTerminal($)
    // Typed here, the focused terminal is this session's when it stands in the session's folder.
    if (own) target = own.columns >= how.minColumns ? own.termId : ''
    else if (how.isPerson) target = await focusedTerminal($)
  }
  if (!target && !how.canCopy) return null

  const opened: Open = { key: crypto.randomUUID(), termId: '', openedAt: await $.clock.now() }
  await update($, open, () => opened)
  await writeFeed($, home, opened)
  if (!target) return opened

  const path = (await $.env.get('PATH')) ?? '/usr/bin:/bin'
  const script = splitScript(target, sideCommand(home, opened.key), [`PATH=${path}`], home)
  const made = (await osascript($, script, 10_000)).trim()
  if (!made) return opened
  const placed = { ...opened, termId: made }
  await update($, open, () => placed)
  await writeFeed($, home, placed)
  return placed
}

/** This session's Ghostty terminal, found by the tty Claude Code draws on, and its width. */
async function ownTerminal($: EngineInterface): Promise<{ termId: string; columns: number } | null> {
  const tty = (await output($, ['/bin/sh', '-c', TTY_SH])).trim()
  if (!/^ttys\d+$/.test(tty)) return null
  const size = (await output($, ['stty', '-f', `/dev/${tty}`, 'size'])).trim().split(/\s+/)
  const termId = (await osascript($, findOwnScript(tty, `claude-side-${crypto.randomUUID()}`), 10_000)).trim()
  return termId ? { termId, columns: Number(size[1] ?? 0) } : null
}

/** The focused Ghostty terminal when it stands in this session's folder; else ''. */
async function focusedTerminal($: EngineInterface): Promise<string> {
  const line = (await osascript($, FOCUSED_SCRIPT, 5_000)).trim()
  const at = line.indexOf(', ')
  if (at <= 0) return ''
  const isOurs = isSessionTerminal(line.slice(at + 2), await $.session.root(), await $.session.cwd())
  return isOurs ? line.slice(0, at) : ''
}

async function osascript($: EngineInterface, script: string, timeoutMs: number): Promise<string> {
  return output($, ['osascript', '-e', script], timeoutMs)
}

/** A command's stdout, or '' when it fails or can't start. */
async function output($: EngineInterface, argv: readonly string[], timeoutMs = 5_000): Promise<string> {
  const ran = await $.process.run(argv, { timeoutMs }).catch(() => null)
  return ran && ran.exitCode === 0 ? ran.stdout : ''
}
