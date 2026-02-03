import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronDown, Plus, Smile, Mic, ArrowUp, MoreHorizontal } from "lucide-react"

import { useChatStore } from "@/stores/chat-store"
import { useConnectionStore } from "@/stores/connection-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { MessageItem } from "@/components/workspace/chat"

const EMPTY: never[] = []

// Codex-style cloud icon
function BroskiIcon({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="1.5"
      className={className}
    >
      <path d="M12 3C8.5 3 6 5.5 6 8.5C4 9 2.5 11 2.5 13.5C2.5 16.5 5 19 8 19H16C19 19 21.5 16.5 21.5 13.5C21.5 11 20 9 18 8.5C18 5.5 15.5 3 12 3Z" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
      <path d="M9 15.5C9 15.5 10.5 17 12 17C13.5 17 15 15.5 15 15.5" strokeLinecap="round"/>
    </svg>
  )
}

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

  const [inputValue, setInputValue] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const parentRef = React.useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = React.useRef(true)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  })

  // Auto-resize textarea
  React.useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px"
    }
  }, [inputValue])

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

  const getAgentLabel = () => {
    switch (agent) {
      case "claude-code": return "Claude"
      case "codex": return "Codex"
      case "opencode": return "OpenCode"
      default: return "Agent"
    }
  }

  const handleSendMessage = React.useCallback(
    (value: string) => {
      if (!value.trim()) return
      appendUserMessage(chatKey, value)
      setInputValue("")
      const cwd = getCwdFor(agent as any, sessionId)
      
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage(inputValue)
    }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      {/* Minimal header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <BroskiIcon className="w-5 h-5 text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text)]">{getAgentLabel()}</span>
        </div>
        <button className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      {/* Messages area */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {/* Empty state */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <BroskiIcon className="w-12 h-12 text-[var(--text-faint)] mb-4" />
                <p className="text-sm text-[var(--text-muted)]">Start a conversation</p>
              </div>
            )}
            
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
                    paddingBottom: "16px",
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Codex-style input bar */}
      <div className="px-6 pb-6">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl border border-[var(--border-input)] bg-[var(--bg-input)] overflow-hidden">
            <div className="px-4 pt-4">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask for follow-up changes"
                rows={1}
                className="w-full bg-transparent text-[var(--text)] placeholder:text-[var(--text-faint)] resize-none focus:outline-none text-base leading-relaxed"
              />
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <button className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <Plus className="w-5 h-5" />
                </button>
                <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <span className="text-sm font-medium">{getAgentLabel()}</span>
                  <span className="text-sm text-[var(--text-faint)]">Default</span>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <Smile className="w-5 h-5" />
                </button>
                <button className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <Mic className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => handleSendMessage(inputValue)}
                  className={`p-2 rounded-full transition-colors ${
                    inputValue.trim() 
                      ? "bg-[var(--accent)] text-[var(--primary-foreground)] hover:bg-[var(--accent-hover)]" 
                      : "bg-[var(--bg-contrast)] text-[var(--text-faint)]"
                  }`}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-1 mt-3">
            <div className="flex items-center gap-4">
              <button className="text-sm text-[var(--text)] font-medium">Local</button>
              <button className="text-sm text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors">Worktree</button>
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--text-faint)]">
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
              </svg>
              <span>main</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
