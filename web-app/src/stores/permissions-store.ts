import { create } from "zustand"

export type ClaudeCodePermissionRequest = {
  agent: "claude-code"
  sessionId: string
  toolUseId: string
  tool: string
  input: unknown
  decisionReason?: string
  blockedPath?: string
  createdAt: number
}

export type CodexPendingRequest = {
  agent: "codex"
  threadId: string
  requestId: string
  method: string
  params: unknown
  createdAt: number
}

export type CodexUserInputRequest = {
  agent: "codex"
  threadId: string
  requestId: string
  questions: Array<{
    id: string
    question: string
    options: Array<{ label: string; description?: string }>
  }>
  createdAt: number
}

type PermissionsState = {
  claudeCode: Record<string, ClaudeCodePermissionRequest[]>
  codexApprovals: Record<string, CodexPendingRequest[]>
  codexUserInputs: Record<string, CodexUserInputRequest[]>
  pendingPermissionsRaw: unknown[]
  pendingQuestionsRaw: unknown[]

  resolveClaudeCodeRequest: (sessionId: string, toolUseId: string) => void
  resolveCodexRequest: (threadId: string, requestId: string) => void
  setPendingPermissions: (items: unknown[]) => void
  setPendingQuestions: (items: unknown[]) => void
}

export const usePermissionsStore = create<PermissionsState>((set) => ({
  claudeCode: {},
  codexApprovals: {},
  codexUserInputs: {},
  pendingPermissionsRaw: [],
  pendingQuestionsRaw: [],

  resolveClaudeCodeRequest: (sessionId, toolUseId) =>
    set((s) => ({
      claudeCode: {
        ...s.claudeCode,
        [sessionId]: (s.claudeCode[sessionId] ?? []).filter(
          (r) => r.toolUseId !== toolUseId
        ),
      },
    })),

  resolveCodexRequest: (threadId, requestId) =>
    set((s) => ({
      codexApprovals: {
        ...s.codexApprovals,
        [threadId]: (s.codexApprovals[threadId] ?? []).filter(
          (r) => r.requestId !== requestId
        ),
      },
      codexUserInputs: {
        ...s.codexUserInputs,
        [threadId]: (s.codexUserInputs[threadId] ?? []).filter(
          (r) => r.requestId !== requestId
        ),
      },
    })),

  setPendingPermissions: (items) => set({ pendingPermissionsRaw: items }),
  setPendingQuestions: (items) => set({ pendingQuestionsRaw: items }),
}))
