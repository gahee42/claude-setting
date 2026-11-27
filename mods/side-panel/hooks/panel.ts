// Pure helpers for the side panel: no `$`, so the tests call them directly.

import type { AgentRow, Info, Pr, Task } from '../types'

export const SHORT_ID = 8
const MAX_AGENTS = 8
const MAX_DONE_TASKS = 3
const ACTIVE = new Set(['pending', 'running', 'waiting'])

type AgentLike = { id: string; type: string; description: string; status: string; name?: string }
type InFlight = { id: string; type: string; description: string; command?: string }

/** `statusline.py --panel` stdout as Info, or null when it is not that. */
export function parseInfo(stdout: string): Info | null {
  try {
    const d = JSON.parse(stdout) as Partial<Info>
    if (typeof d !== 'object' || d === null || !Array.isArray(d.prs)) return null
    const prs = d.prs.filter((p): p is Pr => typeof p?.url === 'string' && typeof p?.num === 'number')
    return { title: typeof d.title === 'string' ? d.title : '', prs }
  } catch {
    return null
  }
}

/** Running agents first, then the most recent others; at most MAX_AGENTS. */
export function agentRows(list: readonly AgentLike[]): AgentRow[] {
  const rows = list.map(a => ({ id: a.id, type: a.type, label: a.name || a.description, status: a.status }))
  const active = rows.filter(r => ACTIVE.has(r.status))
  const rest = rows.filter(r => !ACTIVE.has(r.status)).reverse()
  return [...active, ...rest].slice(0, MAX_AGENTS)
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

/** Every running task, and the last few that ended. */
function trim(list: readonly Task[]): Task[] {
  const done = list.filter(t => !t.isRunning).slice(-MAX_DONE_TASKS)
  return list.filter(t => t.isRunning || done.includes(t))
}

/** Nerd Font glyphs, as claude/statusline.py draws them (MesloLGS NF in the terminal); escaped so they survive copy/paste. */
export const NERD = {
  title: '\uf075', // comment
  sid: '\uf2c1', // id-badge
  pr: '\uf407', // git-pull-request
  merged: '\uf419', // git-merge
  agent: '\uf17b', // android, the status line's agent pill
  shell: '\uf120', // terminal
  running: '\uf110', // spinner
  done: '\uf00c', // check
  failed: '\uf00d', // times
  pending: '\uf252', // hourglass, the status line's 5h
  idle: '\uf28b', // pause-circle
  draft: '\uf044', // pencil, the status line's diff
  capL: '\ue0b6', // round pill caps
  capR: '\ue0b4',
}
export type Glyphs = { [K in keyof typeof NERD]: string }

/** Where no Nerd Font is promised (desktop, VS Code, mobile): plain symbols, no pills. */
export const PLAIN: Glyphs = {
  title: '', sid: '', pr: '', merged: '⇲', agent: '', shell: '',
  running: '●', done: '✓', failed: '✗', pending: '⋯', idle: '○', draft: '✎', capL: '', capR: '',
}

/** The status line's xterm-256 colors (its C table) as hex. */
export const COLOR = {
  ok: '#5faf5f', // 71
  warn: '#d78700', // 172
  bad: '#d75f5f', // 167
  merged: '#af87ff', // 141
  label: '#808080', // 244, stat_label
  dim: '#585858', // 240
  pillBg: '#303030', // 236, stat_bg
  pillFg: '#bcbcbc', // 250, stat_fg
  sidBg: '#5f5f87', // 60, model_bg
  sidFg: '#dadada', // 253, model_fg
  title: '#d7afd7', // 182, title_fg
}

/** The icon, words and color beside a PR's number, as the status line's PR badge reads. */
export function prMark(pr: Pr, g: Glyphs = PLAIN): { text: string; color?: string } {
  if (pr.state === 'MERGED') return { text: `${g.merged} merged`, color: COLOR.merged }
  if (pr.state === 'CLOSED') return { text: `${g.failed} closed`, color: COLOR.dim }
  const ci = { pass: { text: g.done, color: COLOR.ok }, fail: { text: g.failed, color: COLOR.bad }, pending: { text: g.pending, color: COLOR.warn } }
  const mark = ci[pr.ci as keyof typeof ci]
  if (pr.draft) return { text: mark ? `${g.draft} draft ${mark.text}` : `${g.draft} draft`, color: mark?.color ?? COLOR.label }
  return mark ?? { text: '' }
}

/** The icon and color an agent's status gets; `isActive` while it runs. */
export function agentMark(status: string, g: Glyphs = PLAIN): { dot: string; color: string; isActive: boolean } {
  if (ACTIVE.has(status)) return { dot: g.running, color: COLOR.warn, isActive: true }
  if (status === 'completed') return { dot: g.done, color: COLOR.ok, isActive: false }
  if (status === 'failed' || status === 'killed') return { dot: g.failed, color: COLOR.bad, isActive: false }
  return { dot: g.idle, color: COLOR.dim, isActive: false }
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
