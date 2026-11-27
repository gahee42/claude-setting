/** One PR this session opened, with what the status line last fetched for it. */
export type Pr = { url: string; num: number; state: string; draft: boolean; ci: string }

/** What `statusline.py --panel` answers: the AI title and this session's PRs, newest first. */
export type Info = { title: string; prs: Pr[] }

/** A subagent or teammate as the panel lists it. */
export type AgentRow = { id: string; type: string; label: string; status: string }

/** A background shell, monitor or workflow; `isRunning` false once it left the in-flight list. */
export type Task = { id: string; label: string; isRunning: boolean }

declare module 'claude-code' {
  interface PluginState {
    'side-panel': {
      info: Shaped<Info>
      agents: Shaped<AgentRow[]>
      tasks: Shaped<Task[]>
    }
  }
}
