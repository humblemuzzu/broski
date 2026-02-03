import { create } from "zustand"

import type {
  ClaudeCodeStreamMessage,
  ClaudeCodeTranscriptMessage,
  CodexStreamMessage,
  CodexTranscriptMessage,
} from "@/core/types"
import { usePermissionsStore } from "@/stores/permissions-store"
import { useCodexCollabStore } from "@/stores/codex-collab-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useWorkspaceStore } from "@/stores/workspace-store"

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
  ingestClaudeCodeStream: (
    sessionId: string,
    msg: ClaudeCodeStreamMessage
  ) => void
  ingestCodexThreadMessages: (threadId: string, data: CodexTranscriptMessage[]) => void
  ingestCodexStream: (threadId: string, msg: CodexStreamMessage) => void
  ingestOpenCodeSessionMessages: (sessionId: string, data: unknown) => void
  ingestOpenCodeEvent: (event: unknown) => void
  ingestOpenCodeEventBatch: (events: unknown[]) => void
}

function upsertAssistantMessage(
  messages: ChatMessage[],
  id: string,
  patch: Partial<ChatMessage>
) {
  const idx = messages.findIndex((m) => m.id === id)
  if (idx === -1) {
    const nextMessage: ChatMessage = {
      id,
      role: "assistant",
      createdAt: Date.now(),
      text: "",
      ...patch,
    }
    return [
      ...messages,
      nextMessage,
    ]
  }
  const existing = messages[idx]
  const next = { ...existing, ...patch }
  return [...messages.slice(0, idx), next, ...messages.slice(idx + 1)]
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

function upsertById(
  messages: ChatMessage[],
  id: string,
  base: Pick<ChatMessage, "role">,
  patch: Partial<ChatMessage>
) {
  const idx = messages.findIndex((m) => m.id === id)
  if (idx === -1) {
    const nextMessage: ChatMessage = {
      id,
      role: base.role,
      createdAt: Date.now(),
      text: "",
      ...patch,
    }
    return [...messages, nextMessage]
  }
  const existing = messages[idx]
  const next = { ...existing, ...patch }
  return [...messages.slice(0, idx), next, ...messages.slice(idx + 1)]
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

  ingestClaudeCodeStream: (sessionId, msg) => {
    const key = makeKey("claude-code", sessionId)
    get().ensureSession(key)
    set((s) => {
      const messages = s.bySession[key]
      const messageId =
        "messageId" in msg && typeof msg.messageId === "string" && msg.messageId
          ? msg.messageId
          : "cc_current"

      switch (msg.type) {
        case "permission-request": {
          usePermissionsStore.getState().upsertClaudeCodeRequest({
            agent: "claude-code",
            sessionId: msg.sessionId,
            toolUseId: msg.toolUseId,
            tool: msg.tool,
            input: msg.input,
            decisionReason: msg.decisionReason,
            blockedPath: msg.blockedPath,
            createdAt: Date.now(),
          })
          return {
            bySession: {
              ...s.bySession,
              [key]: [
                ...messages,
                {
                  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                  role: "system" as const,
                  createdAt: Date.now(),
                  text: `Permission requested: ${msg.tool}`,
                },
              ],
            },
          }
        }
        case "assistant-message": {
          return {
            bySession: {
              ...s.bySession,
              [key]: upsertAssistantMessage(messages, messageId, {
                text: msg.content,
              }),
            },
          }
        }
        case "assistant-message-delta": {
          const existing = messages.find((m) => m.id === messageId)
          const nextText = (existing?.text ?? "") + msg.content
          return {
            bySession: {
              ...s.bySession,
              [key]: upsertAssistantMessage(messages, messageId, {
                text: nextText,
              }),
            },
          }
        }
        case "thinking-delta": {
          const existing = messages.find((m) => m.id === messageId)
          const nextThinking = (existing?.thinking ?? "") + msg.content
          return {
            bySession: {
              ...s.bySession,
              [key]: upsertAssistantMessage(messages, messageId, {
                thinking: nextThinking,
              }),
            },
          }
        }
        case "tool-call": {
          const existing = messages.find((m) => m.id === messageId)
          const toolCalls = existing?.toolCalls ?? []
          const toolUseId = msg.toolUseId || `${messageId}:${toolCalls.length}`
          const nextToolCalls: ChatToolCall[] = [
            ...toolCalls.filter((t) => t.id !== toolUseId),
            {
              id: toolUseId,
              tool: msg.tool,
              status: msg.status,
              input: msg.input,
            },
          ]
          return {
            bySession: {
              ...s.bySession,
              [key]: upsertAssistantMessage(messages, messageId, {
                toolCalls: nextToolCalls,
              }),
            },
          }
        }
        case "tool-result": {
          const existing = messages.find((m) => m.id === messageId)
          const toolCalls = existing?.toolCalls ?? []
          const toolUseId = msg.toolUseId || "unknown"
          const nextToolCalls: ChatToolCall[] = toolCalls.map((t) =>
            t.id === toolUseId
              ? { ...t, status: "completed", output: msg.result }
              : t
          )
          return {
            bySession: {
              ...s.bySession,
              [key]: upsertAssistantMessage(messages, messageId, {
                toolCalls: nextToolCalls,
              }),
            },
          }
        }
        case "error": {
          return {
            bySession: {
              ...s.bySession,
              [key]: [
                ...messages,
                {
                  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                  role: "system" as const,
                  createdAt: Date.now(),
                  text: `Error: ${msg.message}`,
                },
              ],
            },
          }
        }
        default:
          return s
      }
    })
  },

  ingestCodexStream: (threadId, msg) => {
    const key = makeKey("codex", threadId)
    get().ensureSession(key)
    set((s) => {
      const list = s.bySession[key] ?? []

      const ensureAssistant = (): ChatMessage => {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i]?.role === "assistant") return list[i]
        }
        const created: ChatMessage = {
          id: `cx_assistant_${threadId}`,
          role: "assistant",
          createdAt: Date.now(),
          text: "",
          toolCalls: [],
        }
        return created
      }

      const addSystem = (text: string) => ({
        bySession: {
          ...s.bySession,
          [key]: [
            ...list,
            {
              id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
              role: "system" as const,
              createdAt: Date.now(),
              text,
            },
          ].slice(-800),
        },
      })

      if (msg.type === "error") {
        return addSystem(`[Codex Error] ${msg.code ?? "error"}: ${msg.message}`)
      }

      if (msg.type === "request") {
        const method = msg.method
        const params: any = msg.params ?? {}

        if (method === "item/tool/requestUserInput") {
          const qsRaw = Array.isArray(params.questions) ? params.questions : []
          const questions = qsRaw
            .map((q: any) => {
              const id = typeof q?.id === "string" ? q.id : ""
              const question = typeof q?.question === "string" ? q.question : ""
              const optionsRaw = Array.isArray(q?.options) ? q.options : []
              const options = optionsRaw
                .map((o: any) => ({
                  label: typeof o?.label === "string" ? o.label : "",
                  description:
                    typeof o?.description === "string" ? o.description : undefined,
                }))
                .filter((o: any) => o.label.length > 0)
              if (!id || !question) return null
              return { id, question, options }
            })
            .filter(Boolean) as Array<{
            id: string
            question: string
            options: Array<{ label: string; description?: string }>
          }>

          usePermissionsStore.getState().upsertCodexRequest({
            agent: "codex",
            threadId,
            requestId: msg.requestId,
            questions,
            createdAt: Date.now(),
          })

          return addSystem(`[Codex] Needs input (${questions.length} question(s))`)
        }

        usePermissionsStore.getState().upsertCodexRequest({
          agent: "codex",
          threadId,
          requestId: msg.requestId,
          method,
          params,
          createdAt: Date.now(),
        })

        return addSystem(`[Codex] Approval requested: ${method}`)
      }

      if (msg.type === "notification") {
        const method = msg.method
        const params: any = msg.params ?? {}
        const item = params.item ?? params.cachedItem ?? null

        if (item && typeof item === "object") {
          const itemType = typeof item.type === "string" ? item.type : "item"
          const itemId =
            typeof item.id === "string"
              ? item.id
              : `cx_item_${Date.now()}_${Math.random().toString(16).slice(2)}`

          if (itemType === "userMessage") {
            const content = Array.isArray(item.content) ? item.content : []
            const textParts: string[] = []
            for (const c of content) {
              if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") {
                textParts.push(c.text)
              }
            }
            return {
              bySession: {
                ...s.bySession,
                [key]: [
                  ...list,
                  {
                    id: itemId,
                    role: "user" as const,
                    createdAt: Date.now(),
                    text: textParts.filter(Boolean).join("\n\n"),
                  },
                ].slice(-800),
              },
            }
          }

          if (itemType === "agentMessage") {
            return {
              bySession: {
                ...s.bySession,
                [key]: upsertById(
                  list,
                  itemId,
                  { role: "assistant" },
                  { text: typeof item.text === "string" ? item.text : "" }
                ).slice(-800),
              },
            }
          }

          if (itemType === "reasoning") {
            const summary = Array.isArray(item.summary)
              ? item.summary.filter((x: any) => typeof x === "string").join("\n")
              : ""
            const content = Array.isArray(item.content)
              ? item.content.filter((x: any) => typeof x === "string").join("\n")
              : ""
            const thinking = [summary, content].filter((x) => x.trim().length > 0).join("\n")
            const assistant = ensureAssistant()
            return {
              bySession: {
                ...s.bySession,
                [key]: upsertById(list, assistant.id, { role: "assistant" }, {
                  thinking: `${(assistant.thinking ?? "").trim()}\n${thinking}`.trim(),
                }).slice(-800),
              },
            }
          }

          if (
            itemType === "commandExecution" ||
            itemType === "fileChange" ||
            itemType === "mcpToolCall" ||
            itemType === "webSearch"
          ) {
            const assistant = ensureAssistant()
            const existing = list.find((m) => m.id === assistant.id) ?? assistant
            const prevToolCalls = existing.toolCalls ?? []

            const statusRaw = typeof item.status === "string" ? item.status.toLowerCase() : ""
            const status: ChatToolCall["status"] =
              statusRaw === "completed"
                ? "completed"
                : statusRaw === "failed" || statusRaw === "declined"
                  ? "failed"
                  : "running"

            const toolName =
              itemType === "commandExecution"
                ? "Bash"
                : itemType === "fileChange"
                  ? "ApplyPatch"
                  : itemType === "mcpToolCall"
                    ? `${String(item.server ?? "")}.${String(item.tool ?? "")}`.replace(/^\./, "")
                    : itemType === "webSearch"
                      ? "WebSearch"
                      : "Tool"

            const output =
              itemType === "fileChange"
                ? (() => {
                    const changes = Array.isArray(item.changes) ? item.changes : []
                    const parts: string[] = []
                    for (const ch of changes) {
                      if (ch && typeof ch === "object" && typeof ch.diff === "string") {
                        parts.push(ch.diff)
                      }
                    }
                    const diffText = parts.join("\n").trim()
                    return diffText ? { diff: diffText } : item.aggregatedOutput ?? item.result ?? undefined
                  })()
                : itemType === "commandExecution"
                  ? item.aggregatedOutput ?? item.output ?? undefined
                  : item.result ?? item.output ?? undefined

            const nextToolCalls: ChatToolCall[] = [
              ...prevToolCalls.filter((t) => t.id !== itemId),
              {
                id: itemId,
                tool: toolName,
                status,
                input:
                  itemType === "commandExecution"
                    ? { command: item.command, cwd: item.cwd }
                    : itemType === "webSearch"
                      ? { query: item.query }
                      : item.arguments ?? item.input ?? item,
                output,
              },
            ]

            const patched = upsertById(
              list,
              assistant.id,
              { role: "assistant" },
              { toolCalls: nextToolCalls }
            ).slice(-800)
            // If this assistant message was synthetic, ensure it's present.
            if (!patched.find((m) => m.id === assistant.id)) {
              patched.push({ ...assistant, toolCalls: nextToolCalls })
            }
            return {
              bySession: {
                ...s.bySession,
                [key]: patched,
              },
            }
          }

          // Unknown item: keep a small trace without raw JSON spam.
          return addSystem(`[Codex] ${method}: ${itemType}`)
        }

        // Non-item notifications.
        if (method === "turn/started") return addSystem("[Codex] Turn started…")
        if (method === "turn/completed") return addSystem("[Codex] Turn completed.")
        return addSystem(`[Codex] ${method}`)
      }

      // Collab events etc.
      if ("type" in msg && typeof (msg as any).type === "string" && (msg as any).type.startsWith("collab_")) {
        useCodexCollabStore.getState().addEvent(threadId, (msg as any).type, (msg as any).data)
        // Optional: auto-open spawned threads as chat panels.
        if ((msg as any).type === "collab_spawn_end") {
          const data: any = (msg as any).data
          const newThreadId = typeof data?.newThreadId === "string" ? data.newThreadId : null
          const statusType = data?.status?.type
          const ok =
            statusType === "running" ||
            statusType === "completed" ||
            statusType === "pending_init"
          if (newThreadId && ok && useSettingsStore.getState().autoOpenCodexSpawns) {
            const baseId = `chat:codex:${newThreadId}`
            if (!useWorkspaceStore.getState().hasPanelBaseId(baseId)) {
              useWorkspaceStore.getState().openChat("codex", newThreadId)
            }
          }
        }
        return addSystem(`[Codex] ${(msg as any).type}`)
      }

      return s
    })
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

  ingestOpenCodeEvent: (event) => {
    const e = event as any
    const payload = e?.payload
    const eventType = typeof payload?.type === "string" ? payload.type : null
    const props = payload?.properties ?? {}

    const sessionId =
      (typeof props?.sessionID === "string" && props.sessionID) ||
      (typeof props?.info?.sessionID === "string" && props.info.sessionID) ||
      (typeof props?.part?.sessionID === "string" && props.part.sessionID) ||
      null

    if (!sessionId) return
    const key = makeKey("opencode", sessionId)
    get().ensureSession(key)

    if (eventType === "message.updated") {
      const info = props?.info ?? {}
      const messageId = typeof info.id === "string" ? info.id : null
      if (!messageId) return
      const roleRaw = typeof info.role === "string" ? info.role : "assistant"
      const role: ChatRole =
        roleRaw === "user" || roleRaw === "assistant" || roleRaw === "system"
          ? roleRaw
          : "assistant"
      set((s) => {
        const list = s.bySession[key] ?? []
        return {
          bySession: {
            ...s.bySession,
            [key]: upsertById(list, messageId, { role }, { createdAt: Date.now() }),
          },
        }
      })
      return
    }

    if (eventType === "message.part.updated") {
      const part = props?.part ?? {}
      const messageId = typeof part.messageID === "string" ? part.messageID : null
      if (!messageId) return
      set((s) => {
        const list = s.bySession[key] ?? []
        const existing = list.find((m) => m.id === messageId)
        const baseRole: ChatRole = existing?.role ?? "assistant"

        if (part.type === "text" && typeof part.text === "string") {
          const delta = typeof props?.delta === "string" ? props.delta : null
          const nextText =
            delta && existing?.text != null ? existing.text + delta : part.text
          return {
            bySession: {
              ...s.bySession,
              [key]: upsertById(list, messageId, { role: baseRole }, { text: nextText }),
            },
          }
        }

        if (part.type === "tool") {
          const toolName =
            (typeof part.tool === "string" && part.tool) ||
            (typeof part.name === "string" && part.name) ||
            "tool"
          const statusRaw = part.state?.status
          const status: ChatToolCall["status"] =
            statusRaw === "completed"
              ? "completed"
              : statusRaw === "failed"
                ? "failed"
                : "running"
          const toolId = typeof part.id === "string" ? part.id : `${messageId}:tool`

          const toolCalls = existing?.toolCalls ?? []
          const nextToolCalls: ChatToolCall[] = [
            ...toolCalls.filter((t) => t.id !== toolId),
            {
              id: toolId,
              tool: toolName,
              status,
              input: part.input ?? part.state?.input,
              output: part.state?.output ?? part.state?.result,
            },
          ]
          return {
            bySession: {
              ...s.bySession,
              [key]: upsertById(list, messageId, { role: baseRole }, { toolCalls: nextToolCalls }),
            },
          }
        }

        return s
      })
      return
    }

    // Fallback: keep a lightweight trace entry for unknown event types.
    set((s) => {
      const list = s.bySession[key] ?? []
      return {
        bySession: {
          ...s.bySession,
          [key]: [
            ...list,
            {
              id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
              role: "system" as const,
              createdAt: Date.now(),
              text: `[opencode:${eventType ?? "event"}] ${JSON.stringify(payload)}`,
            },
          ].slice(-500),
        },
      }
    })
  },

  ingestOpenCodeEventBatch: (events) => {
    for (const event of events) get().ingestOpenCodeEvent(event)
  },
}))
