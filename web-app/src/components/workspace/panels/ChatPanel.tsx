import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { useChatStore } from "@/stores/chat-store"
import { useConnectionStore } from "@/stores/connection-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { ChatHeader, MessageItem, ChatInputForm } from "@/components/workspace/chat"

const EMPTY: never[] = []

export function ChatPanel({
  sessionId,
  agent,
}: {
  sessionId: string
  agent: string
}) {
  const chatKey = `${agent}:${sessionId}` as const
  const messages = useChatStore((s) => s.bySession[chatKey] ?? EMPTY)
  const appendUserMessage = useChatStore((s) => s.appendUserMessage)
  const send = useConnectionStore((s) => s.send)
  const getCwdFor = useSessionsStore((s) => s.getCwdFor)
  const openPanel = useWorkspaceStore((s) => s.openPanel)

  const parentRef = React.useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = React.useRef(true)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  })

  React.useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = distanceFromBottom < 80
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  React.useEffect(() => {
    if (!stickToBottomRef.current) return
    if (messages.length === 0) return
    virtualizer.scrollToIndex(messages.length - 1, { align: "end" })
  }, [messages.length, virtualizer])

  const handleSendMessage = React.useCallback(
    (value: string) => {
      appendUserMessage(chatKey, value)
      const cwd = getCwdFor(agent as any, sessionId)
      // Send prompt based on active agent.
      if (agent === "claude-code") {
        send({ type: "cc_chat", sessionId, prompt: value, cwd } as any)
      } else if (agent === "codex") {
        send({ type: "cx_chat", threadId: sessionId, prompt: value, cwd } as any)
      } else {
        const trimmed = value.trim()
        if (trimmed.startsWith("/")) {
          const cmdLine = trimmed.slice(1)
          const [command, ...rest] = cmdLine.split(/\s+/)
          const args = rest.join(" ")
          if (command) {
            send({
              type: "execute_command",
              sessionId,
              command,
              arguments: args,
              projectPath: cwd,
            } as any)
          }
        } else {
          send({ type: "chat", sessionId, content: value, projectPath: cwd } as any)
        }
      }
    },
    [chatKey, appendUserMessage, send, getCwdFor, agent, sessionId]
  )

  const handleOpenCollab = React.useCallback(() => {
    openPanel(`collab:${sessionId}`)
  }, [openPanel, sessionId])

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        sessionId={sessionId}
        agent={agent}
        onOpenCollab={agent === "codex" ? handleOpenCollab : undefined}
      />

      <div ref={parentRef} className="flex-1 overflow-auto p-3">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {messages.length === 0 ? (
            <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-4 text-sm text-muted-foreground">
              No messages yet.
            </div>
          ) : null}
          {virtualizer.getVirtualItems().map((row) => {
            const message = messages[row.index]
            return (
              <MessageItem
                key={message.id}
                message={message}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                  paddingBottom: "8px",
                }}
              />
            )
          })}
        </div>
      </div>

      <ChatInputForm onSend={handleSendMessage} />
    </div>
  )
}
