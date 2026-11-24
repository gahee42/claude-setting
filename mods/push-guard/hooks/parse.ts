// Pure helpers: no `$`, so the tests can call them directly.

/** One push a Bash command would make. */
export type Push = {
  /** The directory the push runs in, as the command names it (`cd`, `git -C`, `--source`); absent: the session's. */
  dir?: string
  /** The remote, as written (a name or a URL); absent for a repository `gh repo create` makes. */
  remote?: string
  /** `owner/repo` (or `repo`) of a repository `gh repo create --push` makes. */
  newRepo?: string
  /** Whether that new repository is made `--public`. */
  isNewRepoPublic?: boolean
}

export type Hit = { file: string; words: string[] }

/** The line `git log --format` writes before each commit's message. */
export const COMMIT_MARK = '@@push-guard-commit@@'
export const MESSAGE = '커밋 메시지'

const SEGMENTS = /&&|\|\||[;\n|]/
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/
const GIT_PUSH = /^git((?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?))*)\s+push(?:\s+(.*))?$/
const GH_REPO_CREATE = /^gh\s+repo\s+create(?:\s+(.*))?$/

export function findPushes(command: string): Push[] {
  const pushes: Push[] = []
  let cdDir: string | undefined

  for (const raw of command.split(SEGMENTS)) {
    const segment = raw.trim().replace(ENV_PREFIX, '')

    const cd = /^cd\s+(.+)$/.exec(segment)
    if (cd?.[1]) {
      cdDir = join(cdDir, unquote(cd[1].trim()))
      continue
    }

    const git = GIT_PUSH.exec(segment)
    if (git) {
      const cDir = /-C\s+(\S+)/.exec(git[1] ?? '')?.[1]
      const dir = cDir ? join(cdDir, unquote(cDir)) : cdDir
      const remote = firstPlain(tokens(git[2] ?? ''))
      pushes.push({ dir, remote: remote ?? 'origin' })
      continue
    }

    const gh = GH_REPO_CREATE.exec(segment)
    if (gh) {
      const args = tokens(gh[1] ?? '')
      if (!args.includes('--push')) continue
      const source = valueOf(args, '--source') ?? valueOf(args, '-s')
      pushes.push({
        dir: source ? join(cdDir, source) : cdDir,
        newRepo: firstPlain(args) ?? '(새 레포)',
        isNewRepoPublic: args.includes('--public'),
      })
    }
  }

  return pushes
}

/** `owner/repo` from a GitHub remote URL, or undefined for any other host. */
export function githubSlug(url: string): string | undefined {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m?.[1] && m[2] ? `${m[1]}/${m[2]}` : undefined
}

export function listWords(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map(word => word.trim())
    .filter(word => word.length > 0)
}

/** Whether the person's own message asks for a push. */
export function mentionsPush(text: string): boolean {
  return /push|푸시|푸쉬|올려|올리자|올립시다|업로드/i.test(text)
}

/**
 * The files (or the commit messages) whose added lines hold a word, read from
 * `git log -p --format=<COMMIT_MARK>%n%B`. Removed and context lines are skipped.
 */
export function scanPatch(patch: string, words: readonly string[]): Hit[] {
  const wanted = words.map(word => word.toLowerCase()).filter(Boolean)
  const found = new Map<string, Set<string>>()
  let file = MESSAGE

  for (const line of patch.split('\n')) {
    if (line === COMMIT_MARK) {
      file = MESSAGE
      continue
    }
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line)
    if (header?.[1]) {
      file = header[1]
      continue
    }

    const isMessage = file === MESSAGE
    if (!isMessage && (!line.startsWith('+') || line.startsWith('+++'))) continue

    const text = (isMessage ? line : line.slice(1)).toLowerCase()
    wanted.forEach((word, i) => {
      if (!text.includes(word)) return
      const set = found.get(file) ?? new Set<string>()
      set.add(words[i] ?? word)
      found.set(file, set)
    })
  }

  return [...found].map(([name, set]) => ({ file: name, words: [...set] }))
}

function tokens(text: string): string[] {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote)
}

/** The first argument that is not an option. `-o`/`--push-option` and `--repo` take a value. */
function firstPlain(args: readonly string[]): string | undefined {
  const takesValue = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo', '-s', '--source', '-d', '--description', '-h', '--homepage', '-t', '--team', '-p', '--template', '-l', '--license', '-g', '--gitignore', '-r', '--remote'])
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (takesValue.has(arg)) {
      i += 1
      continue
    }
    if (!arg.startsWith('-')) return arg
  }
  return undefined
}

function valueOf(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name)
  if (at >= 0) return args[at + 1]
  const inline = args.find(arg => arg.startsWith(`${name}=`))
  return inline?.slice(name.length + 1)
}

function unquote(text: string): string {
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text
}

function join(base: string | undefined, dir: string): string {
  if (!base || dir.startsWith('/') || dir.startsWith('~')) return dir
  return `${base.replace(/\/+$/, '')}/${dir}`
}
