import * as React from "react"
import { Send } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { useChatStore } from "@/stores/chat-store"
import { useConnectionStore } from "@/stores/connection-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToolCallCard } from "@/components/workspace/chat/ToolCallCard"

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

  const [value, setValue] = React.useState("")
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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="text-sm font-semibold">Chat</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Session: {sessionId} · Agent: {agent}
        </div>
      </div>

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
            const m = messages[row.index]
            return (
              <div
                key={m.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                  paddingBottom: "8px",
                }}
              >
                <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {m.role.toUpperCase()}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">
                    {m.text}
                  </div>
                  {m.thinking ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Thinking
                      </summary>
                      <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                        {m.thinking}
                      </div>
                    </details>
                  ) : null}
                  {m.toolCalls && m.toolCalls.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {m.toolCalls.map((t) => (
                        <ToolCallCard key={t.id} toolCall={t} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <form
        className="border-t border-[var(--panel-border)] bg-[var(--panel-header)] p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim()) return
          appendUserMessage(chatKey, value)
          const cwd = getCwdFor(agent as any, sessionId)
          // Send prompt based on active agent.
          if (agent === "claude-code") {
            send({ type: "cc_chat", sessionId, prompt: value, cwd } as any)
          } else if (agent === "codex") {
            send({ type: "cx_chat", threadId: sessionId, prompt: value, cwd } as any)
          } else {
            send({ type: "chat", sessionId, content: value, projectPath: cwd } as any)
          }
          setValue("")
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Message…"
          />
          <Button type="submit" size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
