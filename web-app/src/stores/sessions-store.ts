import { useMemo } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/core/constants"
import type {
  AgentType,
  ClaudeCodeSession,
  CodexThread,
  SessionSummary,
} from "@/core/types"

export type UnifiedSession = {
  id: string
  title: string
  agentType: AgentType
  cwd?: string
  updatedAt?: number
}

type SessionsState = {
  openCodeByProject: Record<string, SessionSummary[]>
  claudeCodeSessions: ClaudeCodeSession[]
  codexThreads: CodexThread[]
  codexNextCursor: string | null

  selectedSessionId: string | null
  selectedSessionAgent: AgentType | null

  setOpenCodeSessions: (projectPath: string | undefined, sessions: SessionSummary[]) => void
  setClaudeCodeSessions: (sessions: ClaudeCodeSession[]) => void
  setCodexThreads: (threads: CodexThread[], nextCursor: string | null) => void
  selectSession: (id: string | null, agent: AgentType | null) => void

  getCwdFor: (agent: AgentType, id: string) => string | undefined
}

export const useSessionsStore = create<SessionsState>()(
  persist(
    (set, get) => ({
      openCodeByProject: {},
      claudeCodeSessions: [],
      codexThreads: [],
      codexNextCursor: null,
      selectedSessionId: null,
      selectedSessionAgent: null,

      setOpenCodeSessions: (projectPath, sessions) => {
        const key = projectPath ?? ""
        set((s) => ({
          openCodeByProject: {
            ...s.openCodeByProject,
            [key]: sessions,
          },
        }))
      },
      setClaudeCodeSessions: (sessions) => set({ claudeCodeSessions: sessions }),
      setCodexThreads: (threads, nextCursor) =>
        set({ codexThreads: threads, codexNextCursor: nextCursor }),
      selectSession: (id, agent) =>
        set({ selectedSessionId: id, selectedSessionAgent: agent }),

      getCwdFor: (agent, id) => {
        if (agent === "claude-code") {
          return get().claudeCodeSessions.find((s) => s.id === id)?.cwd
        }
        if (agent === "codex") {
          return get().codexThreads.find((t) => t.id === id)?.cwd
        }
        // opencode
        for (const sessions of Object.values(get().openCodeByProject)) {
          const found = sessions.find((s) => s.id === id)
          if (found) return found.directory
        }
        return undefined
      },
    }),
    {
      name: STORAGE_KEYS.selectedSession,
      partialize: (s) => ({
        selectedSessionId: s.selectedSessionId,
        selectedSessionAgent: s.selectedSessionAgent,
      }),
    }
  )
)

/**
 * Derive unified sessions from raw store data using useMemo.
 * This avoids creating a new array reference on every render (which would
 * cause an infinite re-render loop when used inside a Zustand selector).
 */
export function useUnifiedSessionsForProject(projectPath: string | null): UnifiedSession[] {
  const openCodeByProject = useSessionsStore((s) => s.openCodeByProject)
  const claudeCodeSessions = useSessionsStore((s) => s.claudeCodeSessions)
  const codexThreads = useSessionsStore((s) => s.codexThreads)

  return useMemo(() => {
    const openCode = openCodeByProject[projectPath ?? ""] ?? []
    const openCodeUnified: UnifiedSession[] = openCode.map((s) => ({
      id: s.id,
      title: s.title || "Untitled",
      agentType: "opencode" as const,
      cwd: s.directory,
      updatedAt: s.time.updated,
    }))

    const ccUnified: UnifiedSession[] = claudeCodeSessions
      .filter((s) =>
        projectPath ? s.cwd === projectPath || s.cwd?.startsWith(projectPath) : true
      )
      .map((s) => ({
        id: s.id,
        title: s.title || "Claude Code",
        agentType: "claude-code" as const,
        cwd: s.cwd,
        updatedAt: s.updatedAt,
      }))

    const cxUnified: UnifiedSession[] = codexThreads
      .filter((t) =>
        projectPath ? t.cwd === projectPath || t.cwd?.startsWith(projectPath) : true
      )
      .map((t) => ({
        id: t.id,
        title: t.preview || "Codex",
        agentType: "codex" as const,
        cwd: t.cwd,
        updatedAt: t.updatedAt * 1000,
      }))

    const all = [...openCodeUnified, ...ccUnified, ...cxUnified]
    all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return all
  }, [openCodeByProject, claudeCodeSessions, codexThreads, projectPath])
}
