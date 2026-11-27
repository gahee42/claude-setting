// Pure helpers for side-panel: no `$`, so the tests call them directly.

import type { Task } from '../types'

const MAX_DONE_TASKS = 3
const ACTIVE = new Set(['pending', 'running', 'waiting'])

type AgentLike = { id: string; type: string; description: string; status: string; name?: string }
type InFlight = { id: string; type: string; description: string; command?: string }

export type AgentRow = { id: string; type: string; label: string; status: string }

/** Running agents first, then the most recent others. */
export function agentRows(list: readonly AgentLike[], max = 8): AgentRow[] {
  const rows = list.map(a => ({ id: a.id, type: a.type, label: a.name || a.description, status: a.status }))
  const active = rows.filter(r => ACTIVE.has(r.status))
  const rest = rows.filter(r => !ACTIVE.has(r.status)).reverse()
  return [...active, ...rest].slice(0, max)
}

/** A shell the Bash tool just put in the background. */
export function trackShell(list: readonly Task[], shell: { id: string; label: string }): Task[] {
  if (list.some(t => t.id === shell.id)) return [...list]
  return trim([...list, { ...shell, isRunning: true }])
}

/** At a turn's end: what is in flight runs, everything else we tracked is done. Subagents are listed apart. */
export function settleTasks(list: readonly Task[], inFlight: readonly InFlight[]): Task[] {
  const live = inFlight.filter(t => t.type !== 'subagent')
  const ids = new Set(live.map(t => t.id))
  const kept = list.map(t => ({ ...t, isRunning: ids.has(t.id) }))
  const added = live
    .filter(t => !list.some(k => k.id === t.id))
    .map(t => ({ id: t.id, label: t.description || t.command || t.type, isRunning: true }))
  return trim([...kept, ...added])
}

function trim(list: readonly Task[]): Task[] {
  const done = list.filter(t => !t.isRunning).slice(-MAX_DONE_TASKS)
  return list.filter(t => t.isRunning || done.includes(t))
}

/** An AppleScript string literal. */
export function asText(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The tty this session's Claude Code draws on: the first of the caller's ancestors that has one. */
export const TTY_SH =
  'p=$PPID; for i in 1 2 3 4 5 6; do t=$(ps -o tty= -p "$p" | tr -d " "); ' +
  'case "$t" in ttys*) echo "$t"; exit 0;; esac; p=$(ps -o ppid= -p "$p" | tr -d " "); done; exit 1'

/**
 * Finds the Ghostty terminal drawn on `tty`, focused or not: titles it `marker` for a moment,
 * asks Ghostty which terminal has that title, then gives the terminal its title back. Prints the
 * terminal's id, or nothing.
 */
export function findOwnScript(tty: string, marker: string): string {
  const title = (of: string) => String.raw`do shell script "printf '\\033]2;%s\\007' " & quoted form of ` + `${of} & " > /dev/${tty}"`
  return [
    `set marker to ${asText(marker)}`,
    'tell application "Ghostty"',
    '  set allIds to id of every terminal',
    '  set allNames to name of every terminal',
    'end tell',
    title('marker'),
    'set myId to ""',
    'repeat 6 times',
    '  tell application "Ghostty" to set found to id of every terminal whose name is marker',
    '  if (count of found) is 1 then',
    '    set myId to item 1 of found',
    '    exit repeat',
    '  end if',
    '  delay 0.15',
    'end repeat',
    'set oldName to ""',
    'repeat with i from 1 to count of allIds',
    '  if item i of allIds is myId then set oldName to item i of allNames',
    'end repeat',
    title('oldName'),
    'return myId',
  ].join('\n')
}

/** The focused terminal of Ghostty's front window; osascript prints `id, working directory`. */
export const FOCUSED_SCRIPT = [
  'tell application "Ghostty"',
  '  set t to focused terminal of selected tab of front window',
  '  return {id of t, working directory of t}',
  'end tell',
].join('\n')

/** Splits terminal `termId` to the left running `command`, gives the keys back to it, returns the new id. */
export function splitScript(termId: string, command: string, env: readonly string[], cwd: string): string {
  return [
    'tell application "Ghostty"',
    `  set t to terminal id ${asText(termId)}`,
    '  set cfg to new surface configuration',
    `  set command of cfg to ${asText(command)}`,
    `  set initial working directory of cfg to ${asText(cwd)}`,
    `  set environment variables of cfg to {${env.map(asText).join(', ')}}`,
    '  set wait after command of cfg to false', // a split made here otherwise stays open, empty, after side.py exits
    '  set s to split t direction left with configuration cfg',
    '  focus t',
    '  return id of s',
    'end tell',
  ].join('\n')
}

/** Whether the terminal at `wd` is the one this session runs in: where it started, or a folder above its cwd. */
export function isSessionTerminal(wd: string, root: string, cwd: string): boolean {
  const clean = (p: string) => p.replace(/\/+$/, '')
  const w = clean(wd)
  return w !== '' && (w === clean(root) || w === clean(cwd) || clean(cwd).startsWith(`${w}/`))
}

/** The command the split runs; `key` names the feed. */
export function sideCommand(home: string, key: string): string {
  return `python3 "${home}/.claude/side.py" ${key}`
}
