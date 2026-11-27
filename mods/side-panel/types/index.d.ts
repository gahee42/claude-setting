/** The split /side opened: the feed's key, and the Ghostty terminal id when Ghostty made it. */
export type Open = { key: string; termId: string; openedAt: number }

/** A background shell, monitor or workflow; `isRunning` false once it left the in-flight list. */
export type Task = { id: string; label: string; isRunning: boolean }

declare module 'claude-code' {
  interface PluginState {
    'side-panel': {
      open: Shaped<Open | null>
      tasks: Shaped<Task[]>
    }
  }
}
