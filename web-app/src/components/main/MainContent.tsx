import * as React from "react"
import {
  Plus,
  ChevronDown,
  ArrowUp,
  Smile,
  Mic,
  Gamepad2,
  FileText,
  GitPullRequest,
  PanelLeft,
} from "lucide-react"

import { useChatStore, type ChatKey } from "@/stores/chat-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"

// Stable empty array
const EMPTY_MESSAGES: never[] = []

// Broski cloud icon
function BroskiIcon({ size = 64 }: { size?: number }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="1.5"
      style={{ color: "#e8e8e8" }}
    >
      <path d="M12 3C8.5 3 6 5.5 6 8.5C4 9 2.5 11 2.5 13.5C2.5 16.5 5 19 8 19H16C19 19 21.5 16.5 21.5 13.5C21.5 11 20 9 18 8.5C18 5.5 15.5 3 12 3Z" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
      <path d="M9 15.5C9 15.5 10.5 17 12 17C13.5 17 15 15.5 15 15.5" strokeLinecap="round"/>
    </svg>
  )
}

// Suggestion card
interface SuggestionCardProps {
  icon: React.ReactNode
  text: string
  onClick?: () => void
}

function SuggestionCard({ icon, text, onClick }: SuggestionCardProps) {
  const [hovered, setHovered] = React.useState(false)
  
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        minWidth: 200,
        maxWidth: 280,
        padding: "16px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "#171717",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s",
      }}
    >
      <div style={{ marginBottom: 12 }}>{icon}</div>
      <p style={{ color: "#a8a8a8", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
        {text}
      </p>
    </button>
  )
}

// Agent labels
const AGENT_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  "claude-code": "Claude Code",
  codex: "Codex",
}

interface MainContentProps {
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
}

export function MainContent({ sidebarOpen, onToggleSidebar }: MainContentProps) {
  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const selectedSessionAgent = useSessionsStore((s) => s.selectedSessionAgent)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const projects = useProjectsStore((s) => s.projects)
  const selectProject = useProjectsStore((s) => s.selectProject)
  const activeAgent = useConnectionStore((s) => s.activeAgent)
  const send = useConnectionStore((s) => s.send)
  
  const [inputValue, setInputValue] = React.useState("")
  const [projectDropdownOpen, setProjectDropdownOpen] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  
  const agent = selectedSessionAgent ?? activeAgent
  const chatKey: ChatKey | null = selectedSessionId 
    ? `${agent}:${selectedSessionId}` as ChatKey 
    : null
  
  const messagesFromStore = useChatStore((s) => 
    chatKey ? s.bySession[chatKey] : undefined
  )
  const messages = messagesFromStore ?? EMPTY_MESSAGES

  // Get project name
  const projectName = selectedProjectPath?.split("/").pop() ?? "Select project"

  // Auto-resize textarea
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [inputValue])

  const handleSend = React.useCallback(() => {
    const text = inputValue.trim()
    if (!text || !selectedSessionId) return

    if (chatKey) {
      useChatStore.getState().appendUserMessage(chatKey, text)
    }

    if (agent === "claude-code") {
      send({ type: "cc_chat", sessionId: selectedSessionId, prompt: text })
    } else if (agent === "codex") {
      send({ type: "cx_chat", threadId: selectedSessionId, prompt: text })
    } else if (agent === "opencode") {
      send({ type: "chat", sessionId: selectedSessionId, content: text })
    }

    setInputValue("")
  }, [agent, chatKey, inputValue, selectedSessionId, send])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Empty state - show hero
  const showHero = !selectedSessionId || messages.length === 0

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "#0f0f0f",
        position: "relative",
      }}
    >
      {/* Toggle sidebar button */}
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            padding: 8,
            borderRadius: 6,
            border: "none",
            backgroundColor: sidebarOpen ? "rgba(255,255,255,0.06)" : "transparent",
            color: "#808080",
            cursor: "pointer",
            zIndex: 10,
          }}
        >
          <PanelLeft size={20} />
        </button>
      )}

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {showHero ? (
          // Hero state
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "48px 24px",
            }}
          >
            {/* Broski icon */}
            <div style={{ marginBottom: 24, opacity: 0.9 }}>
              <BroskiIcon size={72} />
            </div>

            {/* Title */}
            <h1
              style={{
                fontSize: 36,
                fontWeight: 600,
                color: "#e8e8e8",
                margin: "0 0 8px 0",
              }}
            >
              Let's build
            </h1>

            {/* Project selector */}
            <div style={{ position: "relative", marginBottom: 48 }}>
              <button
                onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "none",
                  backgroundColor: "transparent",
                  color: "#808080",
                  fontSize: 20,
                  cursor: "pointer",
                }}
              >
                {projectName}
                <ChevronDown size={18} />
              </button>
              
              {projectDropdownOpen && projects.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    marginTop: 8,
                    width: 280,
                    maxHeight: 300,
                    overflow: "auto",
                    backgroundColor: "#1a1a1a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    zIndex: 100,
                  }}
                >
                  {projects.map((p) => (
                    <button
                      key={p.path}
                      onClick={() => {
                        selectProject(p.path)
                        send({ type: "set_view", projectPath: p.path })
                        setProjectDropdownOpen(false)
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "12px 16px",
                        border: "none",
                        backgroundColor: selectedProjectPath === p.path ? "rgba(255,255,255,0.06)" : "transparent",
                        color: "#e8e8e8",
                        fontSize: 14,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      {p.path.split("/").pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Suggestion cards */}
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                justifyContent: "center",
                maxWidth: 900,
              }}
            >
              <SuggestionCard
                icon={<Gamepad2 size={20} style={{ color: "#808080" }} />}
                text="Build a classic Snake game in this repo."
              />
              <SuggestionCard
                icon={<FileText size={20} style={{ color: "#4ade80" }} />}
                text="Create a one-page PDF that summarizes this app."
              />
              <SuggestionCard
                icon={<GitPullRequest size={20} style={{ color: "#fbbf24" }} />}
                text="Summarize last week's PRs by teammate and theme."
              />
            </div>
          </div>
        ) : (
          // Chat messages
          <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
            <div style={{ maxWidth: 768, margin: "0 auto" }}>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: 24,
                    display: "flex",
                    flexDirection: msg.role === "user" ? "row-reverse" : "row",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: 12,
                      backgroundColor: msg.role === "user" ? "#1a1a1a" : "transparent",
                      maxWidth: "80%",
                    }}
                  >
                    <p style={{ color: "#e8e8e8", fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
                      {msg.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompt bar */}
        <div style={{ padding: "16px 24px 24px", maxWidth: 800, margin: "0 auto", width: "100%" }}>
          <div
            style={{
              backgroundColor: "#171717",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            {/* Textarea */}
            <div style={{ padding: "16px 16px 8px" }}>
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${AGENT_LABELS[activeAgent] || "Broski"} anything, @ to add files, / for commands`}
                rows={1}
                style={{
                  width: "100%",
                  backgroundColor: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#e8e8e8",
                  fontSize: 15,
                  lineHeight: 1.5,
                  resize: "none",
                }}
              />
            </div>

            {/* Bottom toolbar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px 12px",
              }}
            >
              {/* Left side */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "transparent",
                    color: "#808080",
                    cursor: "pointer",
                  }}
                >
                  <Plus size={18} />
                </button>

                {/* Agent selector */}
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "transparent",
                    color: "#a8a8a8",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{AGENT_LABELS[activeAgent] || "Agent"}</span>
                  <ChevronDown size={14} style={{ color: "#5c5c5c" }} />
                </button>
              </div>

              {/* Right side */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "transparent",
                    color: "#5c5c5c",
                    cursor: "pointer",
                  }}
                >
                  <Smile size={18} />
                </button>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "transparent",
                    color: "#5c5c5c",
                    cursor: "pointer",
                  }}
                >
                  <Mic size={18} />
                </button>
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "none",
                    backgroundColor: inputValue.trim() ? "#e8e8e8" : "#333",
                    color: inputValue.trim() ? "#0f0f0f" : "#666",
                    cursor: inputValue.trim() ? "pointer" : "not-allowed",
                    transition: "all 0.15s",
                  }}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Help text */}
          <p
            style={{
              textAlign: "center",
              color: "#5c5c5c",
              fontSize: 12,
              marginTop: 12,
            }}
          >
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  )
}
