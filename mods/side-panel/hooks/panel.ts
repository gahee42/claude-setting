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

/** The words and color beside a PR's number. */
export function prMark(pr: Pr): { text: string; color?: 'success' | 'error' | 'warning' | 'merged' } {
  if (pr.state === 'MERGED') return { text: 'merged', color: 'merged' }
  if (pr.state === 'CLOSED') return { text: 'closed' }
  const ci = { pass: { text: '✓', color: 'success' }, fail: { text: '✗', color: 'error' }, pending: { text: '⋯', color: 'warning' } } as const
  const mark = ci[pr.ci as keyof typeof ci]
  if (pr.draft) return { text: mark ? `draft ${mark.text}` : 'draft', color: mark?.color }
  return mark ?? { text: '' }
}

/** The dot and color an agent's status gets. */
export function agentMark(status: string): { dot: string; color?: 'success' | 'error' | 'warning' } {
  if (ACTIVE.has(status)) return { dot: '●', color: 'warning' }
  if (status === 'completed') return { dot: '✓', color: 'success' }
  if (status === 'failed' || status === 'killed') return { dot: '✗', color: 'error' }
  return { dot: '○' }
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
