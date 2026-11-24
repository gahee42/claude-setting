// Pure helpers: no `$`, so the tests can call them directly.

/** `sysctl -n kern.memorystatus_level` prints the free percentage, e.g. "73\n". */
export function parseLevel(stdout: string): number | null {
  const n = Number.parseInt(stdout.trim(), 10)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

/** The pattern as a case-insensitive RegExp, or undefined when it does not compile. */
export function toPattern(source: string): RegExp | undefined {
  if (source.trim() === '') return undefined
  try {
    return new RegExp(source, 'i')
  } catch {
    return undefined
  }
}

export function commandOf(input: unknown): string {
  if (typeof input !== 'object' || input === null || !('command' in input)) return ''
  const command = (input as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}
