// side-panel
// A sidebar docked right of the transcript, top to bottom, in the terminal's
// fullscreen layout: this session's id (press to copy), its AI title and PRs,
// then the subagents and background shells. /side opens or closes it.
//
// Title and PRs come from `statusline.py --panel` (claude/statusline.py in
// this repo), which reads the caches the status line already keeps. Agents
// come from $.agent.list(); shells from the Bash tool's answer and the
// in-flight list each Stop carries.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { agentMark, agentRows, COLOR, NERD, parseInfo, PLAIN, prMark, same, settleTasks, SHORT_ID, trackShell } from './panel'

const PANE = 'side'
const TITLE = '세션'
const COLUMNS = 32
const AGENTS_MS = 3_000
const INFO_MS = 15_000
const HIDDEN = 'hidden' // $.store: the person closed the panel by hand; /side opens it again

// Change a tag when that value's fields change: a reload declines what an
// earlier version stored.
const info = atom({ plugin: 'side-panel', key: 'info' } as const, { title: '', prs: [] }, { shape: 'info-1' })
const agents = atom({ plugin: 'side-panel', key: 'agents' } as const, [], { shape: 'agents-1' })
const tasks = atom({ plugin: 'side-panel', key: 'tasks' } as const, [], { shape: 'tasks-1' })

export const register: Register = on => {
  let isAutoOpenTried = false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'side', description: '오른쪽 세션 패널을 열거나 닫는다' })
    $.clock.every(AGENTS_MS, () => {
      void refreshAgents($)
    })
    $.clock.every(INFO_MS, () => {
      void refreshInfo($)
    })
    return started
  })

  // Opened unasked only where it docks as a sidebar; the engine seats it from
  // 144 columns, or 110 once the person opened it with /side.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isAutoOpenTried && e.viewport?.isFullscreen === true) {
      isAutoOpenTried = true
      if ((await $.store.get(HIDDEN)) !== true) {
        void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS }).then(() => refresh($))
      }
    }
    return next(e)
  })

  on('command.run', { command: 'side' }, async $ => {
    if (await isOpen($)) {
      await $.ui.close({ id: PANE })
      await $.store.set(HIDDEN, true)
      return { text: '세션 패널을 닫았어요. /side 로 다시 열어요.' }
    }
    await $.store.delete(HIDDEN)
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    await refresh($)
    return { text: opened.isPlaced ? '세션 패널을 열었어요.' : `세션 패널을 열지 못했어요: ${opened.reason ?? ''}` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set(HIDDEN, true)
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const id = await $.session.id()
    const { title, prs } = await read($, info)
    const agentList = await read($, agents)
    const taskList = await read($, tasks)

    const copy = async (press: { surface?: typeof e.surface }) => {
      const copied = await $.ui.copy({ text: id, surface: press.surface })
      $.ui.toast(copied.isCopied ? `세션 ID를 복사했어요: ${id}` : `세션 ID: ${id}`)
    }

    // The terminal draws the status line's Nerd Font: icons and round pills.
    // Elsewhere no such font is promised, so plain symbols and bold labels.
    const isNerd = e.surface === 'terminal'
    const g = isNerd ? NERD : PLAIN
    const pill = (label: string, bg: string, fg: string) =>
      isNerd ? (
        <Text>
          <Text color={bg}>{g.capL}</Text>
          <Text backgroundColor={bg} color={fg}>
            {label}
          </Text>
          <Text color={bg}>{g.capR}</Text>
        </Text>
      ) : (
        <Text bold>{label}</Text>
      )
    const icon = (glyph: string, label: string) => (glyph ? `${glyph} ${label}` : label)
    const none = <Text color={COLOR.dim}> 없음</Text>
    const runningAgents = agentList.filter(a => agentMark(a.status).isActive).length
    const runningTasks = taskList.filter(t => t.isRunning).length

    return (
      <Box flexDirection="column">
        <Text bold color={COLOR.title} maxLines={3}>
          {icon(g.title, title || '(제목 아직 없음)')}
        </Text>
        <Button key="sid" hotkey="c" onPress={copy}>
          {pill(icon(g.sid, `sid ${id.slice(0, SHORT_ID)}`), COLOR.sidBg, COLOR.sidFg)}
          <Text color={COLOR.label}> c 복사</Text>
        </Button>

        <Box marginTop={1} flexDirection="column">
          {pill(icon(g.pr, `PR ${prs.length}`), COLOR.pillBg, COLOR.pillFg)}
          {prs.length === 0 && none}
          {prs.map(pr => {
            const mark = prMark(pr, g)
            return (
              <Text key={pr.url}>
                {' '}
                <Link href={pr.url}>#{String(pr.num)}</Link>
                {mark.text !== '' && <Text color={mark.color}> {mark.text}</Text>}
              </Text>
            )
          })}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {pill(icon(g.agent, `에이전트 ${runningAgents}`), COLOR.pillBg, COLOR.pillFg)}
          {agentList.length === 0 && none}
          {agentList.map(a => {
            const mark = agentMark(a.status, g)
            return (
              <Text key={a.id} wrap="truncate-end">
                {' '}
                <Text color={mark.color}>{mark.dot}</Text>
                <Text color={mark.isActive ? COLOR.pillFg : COLOR.label}> {a.type}</Text>
                <Text color={COLOR.label}> {a.label}</Text>
              </Text>
            )
          })}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {pill(icon(g.shell, `백그라운드 ${runningTasks}`), COLOR.pillBg, COLOR.pillFg)}
          {taskList.length === 0 && none}
          {taskList.map(t => (
            <Text key={t.id} wrap="truncate-end">
              {' '}
              <Text color={t.isRunning ? COLOR.warn : COLOR.ok}>{t.isRunning ? g.running : g.done}</Text>
              <Text color={t.isRunning ? COLOR.pillFg : COLOR.label}> {t.label}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function refresh($: EngineInterface): Promise<void> {
  await Promise.all([refreshAgents($), refreshInfo($)])
}

async function refreshAgents($: EngineInterface): Promise<void> {
  if (!(await isOpen($))) return
  const rows = agentRows(await $.agent.list())
  await update($, agents, old => (same(old, rows) ? old : rows))
}

async function refreshInfo($: EngineInterface): Promise<void> {
  if (!(await isOpen($))) return
  const home = await $.env.get('HOME')
  if (!home) return
  const id = await $.session.id()
  const { transcriptPath } = await $.session.info()
  const argv = ['python3', `${home}/.claude/statusline.py`, '--panel', id, transcriptPath]
  const run = await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => null)
  const fresh = run && run.exitCode === 0 ? parseInfo(run.stdout) : null
  if (fresh) await update($, info, old => (same(old, fresh) ? old : fresh))
}
