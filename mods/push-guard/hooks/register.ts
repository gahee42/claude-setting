// push-guard
// 1. A `git push` (or `gh repo create --push`) waits for the person's OK,
//    unless their latest message asked for the push.
// 2. When the push goes to a public GitHub repository, the commits it would
//    send are read for the words the person blocked; any hit refuses the push
//    and names the file.

import type { EngineInterface, Register } from 'claude-code'

import { COMMIT_MARK, findPushes, githubSlug, listWords, mentionsPush, scanPatch } from './parse'
import type { Push } from './parse'

type Context = {
  words: readonly string[]
  publicRepos: ReadonlySet<string>
  /** `owner/repo` (lowercase) → public, for answers gh gave this session. */
  visibility: Map<string, boolean>
  home?: string
}

export const register: Register = (on, options) => {
  const askOnPush = options.askOnPush !== false
  const trustPrompt = options.trustPrompt !== false
  const ctx: Context = {
    words: listWords(String(options.blockedWords ?? '')),
    publicRepos: new Set(listWords(String(options.publicRepos ?? '')).map(s => s.toLowerCase())),
    visibility: new Map(),
  }
  let lastPrompt = ''

  // Only the person's own message counts (typed, or sent from their phone);
  // a turn started by anything else (a peer, a schedule, a task) clears it.
  on('prompt.submit', ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!e.command) lastPrompt = isPerson && !e.isMeta ? e.text : ''
    return next(e)
  })

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const pushes = findPushes(commandOf(e.input))
    if (pushes.length === 0) return next(e)

    if (ctx.words.length > 0) {
      const cwd = await $.session.cwd()
      for (const push of pushes) {
        const leak = await findLeak($, push, cwd, ctx)
        if (leak) return { decision: 'deny' as const, reason: leak }
      }
    }

    const verdict = await next(e)
    if (!askOnPush || verdict.decision === 'deny') return verdict
    if (trustPrompt && mentionsPush(lastPrompt)) return verdict
    if (!e.approver) {
      return { decision: 'deny' as const, reason: 'push-guard: 확인해 줄 사람이 없는 세션이라 push를 막았어요.' }
    }
    return { decision: 'ask' as const, reason: 'push-guard: push 전에 확인해 주세요.' }
  }).catch(($, e, next) =>
    next.called ? next(e) : { decision: 'ask' as const, reason: 'push-guard: 검사 중 오류가 나서 직접 확인을 받아요.' },
  )
}

async function findLeak($: EngineInterface, push: Push, cwd: string, ctx: Context): Promise<string | undefined> {
  const dir = await resolveDir($, push.dir, cwd, ctx)
  let slug = push.newRepo
  let isPublic = push.isNewRepoPublic === true

  if (push.newRepo === undefined) {
    slug = await remoteSlug($, dir, push.remote ?? 'origin')
    if (!slug) return undefined
    isPublic = await checkPublic($, slug, ctx)
  }
  if (!isPublic) return undefined

  const hits = scanPatch(await outgoing($, dir, push), ctx.words)
  if (hits.length === 0) return undefined

  const list = hits.map(hit => `${hit.file} (${hit.words.join(', ')})`).join(', ')
  return `push-guard: 공개 레포 ${slug}에 올리면 안 되는 말이 들어 있어요: ${list}. 지우거나 바꾼 뒤 다시 push해 주세요.`
}

async function remoteSlug($: EngineInterface, dir: string, remote: string): Promise<string | undefined> {
  const direct = githubSlug(remote)
  if (direct) return direct
  for (const name of remote === 'origin' ? ['origin'] : [remote, 'origin']) {
    const r = await $.process.run(['git', '-C', dir, 'remote', 'get-url', name], { timeoutMs: 5_000 })
    if (r.exitCode === 0) return githubSlug(r.stdout)
  }
  return undefined
}

async function checkPublic($: EngineInterface, slug: string, ctx: Context): Promise<boolean> {
  const key = slug.toLowerCase()
  if (ctx.publicRepos.has(key)) return true
  const known = ctx.visibility.get(key)
  if (known !== undefined) return known

  try {
    const r = await $.process.run(['gh', 'repo', 'view', slug, '--json', 'visibility', '-q', '.visibility'], { timeoutMs: 10_000 })
    if (r.exitCode !== 0) return false // unknown (no access, offline): not cached, asked again next time
    const isPublic = r.stdout.trim() === 'PUBLIC'
    ctx.visibility.set(key, isPublic)
    return isPublic
  } catch {
    return false // gh is not installed
  }
}

async function outgoing($: EngineInterface, dir: string, push: Push): Promise<string> {
  const range = push.newRepo === undefined ? await rangeOf($, dir, push.remote ?? 'origin') : ['HEAD']
  const r = await $.process.run(
    ['git', '-C', dir, 'log', '-p', '--no-color', '--no-ext-diff', `--format=${COMMIT_MARK}%n%B`, ...range],
    { timeoutMs: 30_000 },
  )
  return r.exitCode === 0 ? r.stdout : ''
}

async function rangeOf($: EngineInterface, dir: string, remote: string): Promise<string[]> {
  const up = await $.process.run(['git', '-C', dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 5_000 })
  const upstream = up.stdout.trim()
  if (up.exitCode === 0 && upstream) return [`${upstream}..HEAD`]
  const name = githubSlug(remote) ? 'origin' : remote
  return ['HEAD', '--not', `--remotes=${name}`]
}

async function resolveDir($: EngineInterface, dir: string | undefined, cwd: string, ctx: Context): Promise<string> {
  if (!dir) return cwd
  if (dir === '~' || dir.startsWith('~/')) {
    ctx.home ??= (await $.process.run(['printenv', 'HOME'], { timeoutMs: 5_000 })).stdout.trim()
    return `${ctx.home}${dir.slice(1)}`
  }
  return dir.startsWith('/') ? dir : `${cwd.replace(/\/+$/, '')}/${dir}`
}

function commandOf(input: unknown): string {
  if (typeof input !== 'object' || input === null || !('command' in input)) return ''
  const command = (input as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}
