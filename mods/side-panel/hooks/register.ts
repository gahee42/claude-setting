// side-panel
// /side opens a tall column of this session's info LEFT of Claude Code, top to bottom: title,
// session id, artifacts, PRs, agents, background shells. Claude Code docks a mod's pane on the
// right only, so the column is a terminal split. In Ghostty /side makes it by AppleScript and
// hands the keys back to Claude Code; elsewhere it copies the command to paste into a split.
// The split runs ~/.claude/side.py (claude/side.py in this repo), which reads the feed this
// mod writes every two seconds, ~/.claude/side/<key>.json, and touches <key>.alive while it
// runs. /side again, or the session's end, closes it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Open } from '../types'
import { agentRows, FOCUSED_SCRIPT, isSessionTerminal, settleTasks, sideCommand, splitScript, trackShell } from './side'

const FEED_MS = 2_000
const GONE_MS = 15_000 // side.py's heartbeat stopped this long ago: the split was closed by hand
const WAIT_MS = 5 * 60_000 // a pasted command that never started

// Change a tag when that value's fields change: a reload declines what an earlier version stored.
const open = atom({ plugin: 'side-panel', key: 'open' } as const, null, { shape: 'open-1' })
const tasks = atom({ plugin: 'side-panel', key: 'tasks' } as const, [], { shape: 'tasks-1' })

type Extra = { ended?: true; closed?: true }

// /clear ends the session and starts the next without a session.start; the panel follows it.
let carried: Open | null = null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'side', description: '왼쪽에 세로로 긴 세션 패널을 열거나 닫는다' })
    $.clock.every(FEED_MS, () => {
      void tick($)
    })
    return started
  })

  on('command.run', { command: 'side' }, async ($, e) => {
    const home = await $.env.get('HOME')
    if (!home) return { text: 'HOME 을 몰라서 패널을 열 수 없어요.' }

    const current = await read($, open)
    if (current) {
      await writeFeed($, home, current, { closed: true })
      await update($, open, () => null)
      return { text: '세션 패널을 닫았어요.' }
    }

    const opened: Open = { key: crypto.randomUUID(), termId: '', openedAt: await $.clock.now() }
    await update($, open, () => opened)
    await writeFeed($, home, opened)
    const command = sideCommand(home, opened.key)

    // Only for a command the person typed here: the focused terminal is then this session's.
    if (e.origin.kind === 'composer' && (await $.env.get('TERM_PROGRAM')) === 'ghostty') {
      const termId = await splitGhostty($, home, command)
      if (termId) {
        const placed = { ...opened, termId }
        await update($, open, () => placed)
        await writeFeed($, home, placed)
        return { text: '왼쪽에 세션 패널을 열었어요. /side 로 닫아요.' }
      }
    }
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

/** Splits this session's Ghostty terminal to the left; the new terminal's id, or '' when it can't. */
async function splitGhostty($: EngineInterface, home: string, command: string): Promise<string> {
  const focused = await $.process.run(['osascript', '-e', FOCUSED_SCRIPT], { timeoutMs: 5_000 }).catch(() => null)
  if (!focused || focused.exitCode !== 0) return ''
  const line = focused.stdout.trim()
  const at = line.indexOf(', ')
  const termId = at > 0 ? line.slice(0, at) : ''
  const wd = at > 0 ? line.slice(at + 2) : ''
  if (!termId || !isSessionTerminal(wd, await $.session.root(), await $.session.cwd())) return ''

  const path = (await $.env.get('PATH')) ?? '/usr/bin:/bin'
  const script = splitScript(termId, command, [`PATH=${path}`], home)
  const made = await $.process.run(['osascript', '-e', script], { timeoutMs: 10_000 }).catch(() => null)
  return made && made.exitCode === 0 ? made.stdout.trim() : ''
}
