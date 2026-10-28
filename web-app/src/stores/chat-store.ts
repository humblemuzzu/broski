import { create } from "zustand"

import type {
  ClaudeCodeTranscriptMessage,
  CodexTranscriptMessage,
} from "@/core/types"

export type ChatRole = "user" | "assistant" | "system"

export type ChatToolCall = {
  id: string
  tool: string
  status: "running" | "completed" | "failed"
  input?: unknown
  output?: unknown
}

export type ChatMessage = {
  id: string
  role: ChatRole
  createdAt: number
  text: string
  thinking?: string
  toolCalls?: ChatToolCall[]
}

export type ChatKey = `${string}:${string}`

type ChatState = {
  bySession: Record<ChatKey, ChatMessage[]>

  ensureSession: (key: ChatKey) => void
  appendUserMessage: (key: ChatKey, text: string) => void
  ingestClaudeCodeTranscriptMessages: (
    sessionId: string,
    data: ClaudeCodeTranscriptMessage[]
  ) => void
  ingestCodexThreadMessages: (threadId: string, data: CodexTranscriptMessage[]) => void
  ingestOpenCodeSessionMessages: (sessionId: string, data: unknown) => void
}

function makeKey(agent: string, id: string): ChatKey {
  return `${agent}:${id}` as ChatKey
}

function normalizeTimestampMs(ts: number): number {
  if (!Number.isFinite(ts)) return Date.now()
  // Heuristic: if it's in seconds, convert.
  if (ts > 0 && ts < 1_000_000_000_000) return Math.floor(ts * 1000)
  return Math.floor(ts)
}

export const useChatStore = create<ChatState>((set, get) => ({
  bySession: {},

  ensureSession: (key) =>
    set((s) =>
      s.bySession[key]
        ? {}
        : { bySession: { ...s.bySession, [key]: [] } }
    ),

  appendUserMessage: (key, text) => {
    get().ensureSession(key)
    set((s) => ({
      bySession: {
        ...s.bySession,
        [key]: [
          ...s.bySession[key],
          {
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            role: "user" as const,
            createdAt: Date.now(),
            text,
          },
        ],
      },
    }))
  },

  ingestClaudeCodeTranscriptMessages: (sessionId, data) => {
    const key = makeKey("claude-code", sessionId)
    get().ensureSession(key)
    const next: ChatMessage[] = (Array.isArray(data) ? data : []).map((m) => {
      const toolCalls: ChatToolCall[] = []
      const baseToolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : []
      for (const t of baseToolCalls) {
        toolCalls.push({
          id: t.toolUseId,
          tool: t.tool,
          status:
            t.status === "completed"
              ? "completed"
              : t.status === "failed"
                ? "failed"
                : "running",
          input: t.input,
          output: t.output,
        })
      }
      const diffs = Array.isArray(m.diffs) ? m.diffs : []
      for (const d of diffs) {
        toolCalls.push({
          id: `${m.id}:diff:${d.file}`,
          tool: `Diff`,
          status: "completed",
          input: { file: d.file, additions: d.additions, deletions: d.deletions },
          output: d.diff
            ? { diff: d.diff }
            : { before: d.before, after: d.after },
        })
      }
      return {
        id: m.id,
        role: m.role,
        createdAt: normalizeTimestampMs(m.createdAt),
        text: m.text ?? "",
        thinking: m.thinking,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }
    })
    set((s) => ({
      bySession: { ...s.bySession, [key]: next },
    }))
  },

  ingestCodexThreadMessages: (threadId, data) => {
    const key = makeKey("codex", threadId)
    get().ensureSession(key)
    const next: ChatMessage[] = (Array.isArray(data) ? data : []).map((m) => {
      const toolCalls: ChatToolCall[] = []
      const baseToolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : []
      for (const t of baseToolCalls) {
        toolCalls.push({
          id: t.itemId,
          tool: t.name,
          status:
            t.status === "completed"
              ? "completed"
              : t.status === "failed" || t.status === "declined"
                ? "failed"
                : "running",
          input: t.input,
          output: t.output,
        })
      }
      const diffs = Array.isArray(m.diffs) ? m.diffs : []
      for (const d of diffs) {
        toolCalls.push({
          id: `${m.id}:diff:${d.file}`,
          tool: "Diff",
          status: "completed",
          input: { file: d.file, additions: d.additions, deletions: d.deletions },
          output: { diff: d.diff },
        })
      }
      return {
        id: m.id,
        role: m.role,
        createdAt: normalizeTimestampMs(m.createdAt),
        text: m.text ?? "",
        thinking: m.thinking,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }
    })
    set((s) => ({
      bySession: { ...s.bySession, [key]: next },
    }))
  },

  ingestOpenCodeSessionMessages: (sessionId, data) => {
    const key = makeKey("opencode", sessionId)
    const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.messages) ? (data as any).messages : null
    if (!rows) return
    get().ensureSession(key)

    set((s) => {
      const existing = s.bySession[key] ?? []
      const byId = new Map(existing.map((m) => [m.id, m] as const))

      for (const m of rows) {
        const info = (m as any)?.info ?? {}
        const messageId = typeof info.id === "string" ? info.id : null
        if (!messageId) continue
        const roleRaw = typeof info.role === "string" ? info.role : "assistant"
        const role: ChatRole =
          roleRaw === "user" || roleRaw === "assistant" || roleRaw === "system"
            ? roleRaw
            : "assistant"

        const parts = Array.isArray((m as any)?.parts) ? (m as any).parts : []
        let text = ""
        const toolCalls: ChatToolCall[] = []
        for (const p of parts) {
          if (!p || typeof p !== "object") continue
          if (p.type === "text" && typeof p.text === "string") {
            text += p.text
          }
          if (p.type === "tool") {
            const toolName =
              (typeof (p as any).tool === "string" && (p as any).tool) ||
              (typeof (p as any).name === "string" && (p as any).name) ||
              "tool"
            const toolId = typeof (p as any).id === "string" ? (p as any).id : `${messageId}:tool`
            const statusRaw = (p as any).state?.status
            const status: ChatToolCall["status"] =
              statusRaw === "completed"
                ? "completed"
                : statusRaw === "failed"
                  ? "failed"
                  : "running"
            toolCalls.push({
              id: toolId,
              tool: toolName,
              status,
              input: (p as any).input ?? (p as any).state?.input,
              output: (p as any).state?.output ?? (p as any).state?.result,
            })
          }
        }

        const next: ChatMessage = {
          id: messageId,
          role,
          createdAt: Date.now(),
          text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        }
        byId.set(messageId, { ...(byId.get(messageId) ?? next), ...next })
      }

      const merged = Array.from(byId.values())
      return {
        bySession: {
          ...s.bySession,
          [key]: merged,
        },
      }
    })
  },
}))
