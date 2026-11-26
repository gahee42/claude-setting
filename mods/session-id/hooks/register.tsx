// session-id
// Shows this session's id beside the prompt and copies it with /sid. Pasted
// into another session's message ("세션 <id> 에 ... 전해 줘"), it lets Claude
// there send to this one: SendMessage takes an id the person wrote.
// The id is read on each use, since /clear gives the session a new one.

import type { EngineInterface, Register } from 'claude-code'

const SHORT = 8

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sid',
      description: '이 세션 ID를 복사한다 (다른 세션에 붙여 넣어 일을 시킬 때)',
    })
    return next(e)
  })

  on('command.run', { command: 'sid' }, async $ => ({ text: await copyId($) }))

  // In the terminal's fullscreen layout and the desktop's Code tab.
  on('ui.render', { component: 'BesidePrompt' }, async ($, e, next) => {
    const id = await $.session.id()
    const label = `sid ${id.slice(0, SHORT)}`
    if (!id || e.props.maxColumns < label.length) return next(e)

    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{label}</Text>
  })
}

async function copyId($: EngineInterface): Promise<string> {
  const id = await $.session.id()
  if (!id) return '이 세션은 ID가 없어요.'

  const copied = await $.ui.copy({ text: id })
  const head = copied.isCopied
    ? `세션 ID를 복사했어요: ${id}`
    : `세션 ID: ${id} (클립보드 복사는 안 됐어요: ${copied.reason})`
  return `${head}\n다른 세션에 "세션 ${id} 에 …라고 전해 줘"처럼 붙여 넣으면 그 세션으로 보내요.`
}
