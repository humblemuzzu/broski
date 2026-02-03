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

  upsertClaudeCodeRequest: (req: ClaudeCodePermissionRequest) => void
  resolveClaudeCodeRequest: (sessionId: string, toolUseId: string) => void
  upsertCodexRequest: (req: CodexPendingRequest | CodexUserInputRequest) => void
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

  upsertClaudeCodeRequest: (req) =>
    set((s) => {
      const list = s.claudeCode[req.sessionId] ?? []
      const next = [
        req,
        ...list.filter((r) => r.toolUseId !== req.toolUseId),
      ].slice(0, 50)
      return {
        claudeCode: {
          ...s.claudeCode,
          [req.sessionId]: next,
        },
      }
    }),

  resolveClaudeCodeRequest: (sessionId, toolUseId) =>
    set((s) => ({
      claudeCode: {
        ...s.claudeCode,
        [sessionId]: (s.claudeCode[sessionId] ?? []).filter(
          (r) => r.toolUseId !== toolUseId
        ),
      },
    })),

  upsertCodexRequest: (req) =>
    set((s) => {
      if ("questions" in req) {
        const list = s.codexUserInputs[req.threadId] ?? []
        const next = [
          req,
          ...list.filter((r) => r.requestId !== req.requestId),
        ].slice(0, 25)
        return {
          codexUserInputs: { ...s.codexUserInputs, [req.threadId]: next },
        }
      }
      const list = s.codexApprovals[req.threadId] ?? []
      const next = [
        req,
        ...list.filter((r) => r.requestId !== req.requestId),
      ].slice(0, 50)
      return {
        codexApprovals: { ...s.codexApprovals, [req.threadId]: next },
      }
    }),

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
