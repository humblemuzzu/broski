import { create } from "zustand"

import type { Agent, Command, LspServerStatus, SessionContextInfo, Todo } from "@/core/types"

type OpenCodeState = {
  todosBySession: Record<string, Todo[]>
  commandsByProject: Record<string, Command[]>
  agentsByProject: Record<string, Agent[]>
  lspByProject: Record<string, LspServerStatus[]>
  contextBySession: Record<string, SessionContextInfo>

  setTodos: (sessionId: string, todos: Todo[]) => void
  setCommands: (projectPath: string | null, commands: Command[]) => void
  setAgents: (projectPath: string | null, agents: Agent[]) => void
  setLsp: (projectPath: string | null, lsp: LspServerStatus[]) => void
  setContext: (sessionId: string, ctx: SessionContextInfo) => void
}

export const useOpenCodeStore = create<OpenCodeState>((set) => ({
  todosBySession: {},
  commandsByProject: {},
  agentsByProject: {},
  lspByProject: {},
  contextBySession: {},

  setTodos: (sessionId, todos) =>
    set((s) => ({
      todosBySession: { ...s.todosBySession, [sessionId]: todos },
    })),
  setCommands: (projectPath, commands) =>
    set((s) => ({
      commandsByProject: { ...s.commandsByProject, [projectPath ?? ""]: commands },
    })),
  setAgents: (projectPath, agents) =>
    set((s) => ({
      agentsByProject: { ...s.agentsByProject, [projectPath ?? ""]: agents },
    })),
  setLsp: (projectPath, lsp) =>
    set((s) => ({
      lspByProject: { ...s.lspByProject, [projectPath ?? ""]: lsp },
    })),
  setContext: (sessionId, ctx) =>
    set((s) => ({
      contextBySession: { ...s.contextBySession, [sessionId]: ctx },
    })),
}))

