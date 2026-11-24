// mem-band
// Every 15 seconds, reads how much memory macOS has free. Below `warnAt` a
// row above the prompt says so; below `askBelow` a toast fires once and a
// heavy Bash command (browser tests, docker builds) waits for the person's OK.
// Elsewhere than macOS the reading fails and the mod stays quiet.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { commandOf, parseLevel, toPattern } from './memory'

const POLL_MS = 15_000
const free = atom({ plugin: 'mem-band', key: 'free' } as const, null)

type Context = {
  askBelow: number
  latest: number | null
  wasLow: boolean
}

export const register: Register = (on, options) => {
  const warnAt = Number(options.warnAt ?? 25)
  const heavy = toPattern(String(options.heavyCommands ?? ''))
  const ctx: Context = { askBelow: Number(options.askBelow ?? 12), latest: null, wasLow: false }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(POLL_MS, () => {
      void poll($, ctx)
    })
    await poll($, ctx)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const level = await read($, free)
    if (level === null || level >= warnAt || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const isLow = level < ctx.askBelow

    return (
      <Box>
        <Text color={isLow ? 'error' : 'warning'}>
          메모리 여유 {level}%{isLow ? ' · 무거운 테스트·빌드는 실행 전에 물어봐요' : ''}
        </Text>
      </Box>
    )
  })

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    const level = ctx.latest
    if (verdict.decision === 'deny' || level === null || level >= ctx.askBelow) return verdict
    if (!heavy?.test(commandOf(e.input)) || !e.approver) return verdict
    return { decision: 'ask' as const, reason: `mem-band: 메모리 여유가 ${level}%예요. 그래도 실행할까요?` }
  })
}

async function poll($: EngineInterface, ctx: Context): Promise<void> {
  let level: number | null = null
  try {
    const r = await $.process.run(['sysctl', '-n', 'kern.memorystatus_level'], { timeoutMs: 3_000 })
    level = r.exitCode === 0 ? parseLevel(r.stdout) : null
  } catch {
    level = null
  }

  ctx.latest = level
  await update($, free, () => level)

  const isLow = level !== null && level < ctx.askBelow
  if (isLow && !ctx.wasLow) $.ui.toast(`메모리 여유 ${level}% — 무거운 작업은 잠시 미뤄요`)
  ctx.wasLow = isLow
}
