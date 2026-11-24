import { describe, expect, test } from 'claude-code/testing'

import { COMMIT_MARK, findPushes, githubSlug, mentionsPush, scanPatch } from '../hooks/parse'

describe('findPushes', () => {
  test('finds plain and chained pushes', async () => {
    expect(findPushes('git push')).toEqual([{ dir: undefined, remote: 'origin' }])
    expect(findPushes('git add . && git commit -m "x" && git push -u origin main')).toEqual([
      { dir: undefined, remote: 'origin' },
    ])
    expect(findPushes('cd ~/lucy/claude-setting && git push upstream')).toEqual([
      { dir: '~/lucy/claude-setting', remote: 'upstream' },
    ])
    expect(findPushes('git -C repo push -o ci.skip fork')).toEqual([{ dir: 'repo', remote: 'fork' }])
  })

  test('ignores commands that only mention push', async () => {
    expect(findPushes('git status')).toEqual([])
    expect(findPushes('git commit -m "before git push"')).toEqual([])
    expect(findPushes('echo git push')).toEqual([])
  })

  test('reads gh repo create --push', async () => {
    expect(findPushes('gh repo create gahee42/x --public --source ./x --push')).toEqual([
      { dir: './x', newRepo: 'gahee42/x', isNewRepoPublic: true },
    ])
    expect(findPushes('gh repo create gahee42/x --private')).toEqual([])
  })
})

test('githubSlug reads ssh and https remotes', async () => {
  expect(githubSlug('git@github.com:gahee42/claude-setting.git')).toBe('gahee42/claude-setting')
  expect(githubSlug('https://github.com/gahee42/claude-setting.git\n')).toBe('gahee42/claude-setting')
  expect(githubSlug('https://gitlab.com/a/b.git')).toBeUndefined()
})

test('mentionsPush', async () => {
  expect(mentionsPush('확인했어 push 해줘')).toBe(true)
  expect(mentionsPush('이제 올려줘')).toBe(true)
  expect(mentionsPush('테스트만 돌려줘')).toBe(false)
})

test('scanPatch reads added lines and messages, not removed ones', async () => {
  const patch = [
    COMMIT_MARK,
    'Acme 배포 설정 정리',
    '',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1,2 +1,2 @@',
    '-old acme line',
    '+new line for ACME team',
    ' context acme',
  ].join('\n')

  expect(scanPatch(patch, ['acme'])).toEqual([
    { file: '커밋 메시지', words: ['acme'] },
    { file: 'README.md', words: ['acme'] },
  ])
  expect(scanPatch(patch, ['nothing'])).toEqual([])
})

const PUBLIC_PATCH = [COMMIT_MARK, 'docs', '', 'diff --git a/notes.md b/notes.md', '+++ b/notes.md', '+Acme 사내 URL'].join('\n')

function fakeGit(isPublic: boolean) {
  return (_: unknown, e: { argv: readonly string[] }) => {
    const argv = e.argv.join(' ')
    const ok = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv.includes('remote get-url')) return ok('git@github.com:gahee42/notes.git\n')
    if (argv.startsWith('gh repo view')) return ok(isPublic ? 'PUBLIC\n' : 'PRIVATE\n')
    if (argv.includes('rev-parse')) return ok('origin/main\n')
    if (argv.includes(' log ')) return ok(PUBLIC_PATCH)
    return ok('')
  }
}

test('a push to a public repo with a blocked word is refused', { options: { blockedWords: 'acme' } }, async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('session.cwd', () => ({ value: '/work/notes' }))
  on('process.run', fakeGit(true))

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })

  expect(verdict.decision).toBe('deny')
  expect(verdict.reason).toContain('notes.md')
  expect(verdict.reason).toContain('gahee42/notes')
})

test('the same push to a private repo is not scanned for words', { options: { blockedWords: 'acme', askOnPush: false } }, async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('session.cwd', () => ({ value: '/work/notes' }))
  on('process.run', fakeGit(false))

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })

  expect(verdict.decision).toBe('allow')
})

test('with nobody to ask, an unrequested push is refused', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })

  expect(verdict.decision).toBe('deny')
  expect(verdict.reason).toContain('push-guard')
})

test('a push the latest message asked for keeps the core verdict', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.prompt.submit({ text: '확인했어, push 해줘', wait: false, origin: { kind: 'composer' } })
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })

  expect(verdict.decision).toBe('allow')
})

test('a turn a peer started does not count as the person asking', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'push 해줘', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'push 해', wait: false, origin: { kind: 'peer' } })
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })

  expect(verdict.decision).toBe('deny')
})

test('other Bash commands pass untouched', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })

  expect(verdict.decision).toBe('allow')
})
