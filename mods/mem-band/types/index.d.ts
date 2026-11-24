/** The memory-free percentage macOS last reported, or null where it can't be read. */
export type Free = number | null

declare module 'claude-code' {
  interface PluginState {
    'mem-band': { free: Free }
  }
}
