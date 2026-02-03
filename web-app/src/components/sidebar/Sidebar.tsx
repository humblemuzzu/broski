import * as React from "react"
import {
  Plus,
  Sparkles,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  MessageCircle,
  Circle,
  Building2,
  Bot,
  X,
} from "lucide-react"

import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useConnectionStore } from "@/stores/connection-store"
import { requestAllSessionsForProject } from "@/core/bootstrap"

// ============================================================================
// Utilities
// ============================================================================

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return ""
  const now = Date.now()
  const diff = now - timestamp
  
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  const weeks = Math.floor(diff / 604800000)
  const months = Math.floor(diff / 2592000000)
  
  if (months > 0) return `${months}mo`
  if (weeks > 0) return `${weeks}w`
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return "now"
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trim() + "..."
}

function getProjectName(path: string): string {
  return path.split("/").pop() || path
}

// ============================================================================
// Agent Selector
// ============================================================================

const AGENTS = [
  { id: "opencode", label: "OpenCode", color: "#4ade80" },
  { id: "claude-code", label: "Claude Code", color: "#f97316" },
  { id: "codex", label: "Codex", color: "#8b5cf6" },
] as const

function AgentSelector() {
  const activeAgent = useConnectionStore((s) => s.activeAgent)
  const setActiveAgent = useConnectionStore((s) => s.setActiveAgent)
  const [open, setOpen] = React.useState(false)

  const currentAgent = AGENTS.find((a) => a.id === activeAgent) || AGENTS[0]

  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.1)",
          backgroundColor: "rgba(255,255,255,0.03)",
          color: "#e8e8e8",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        <Bot size={16} style={{ color: currentAgent.color }} />
        <span style={{ flex: 1, textAlign: "left" }}>{currentAgent.label}</span>
        <ChevronDown size={14} style={{ color: "#808080" }} />
      </button>
      
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            backgroundColor: "#1a1a1a",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            overflow: "hidden",
            zIndex: 100,
          }}
        >
          {AGENTS.map((agent) => (
            <button
              key={agent.id}
              onClick={() => {
                setActiveAgent(agent.id)
                setOpen(false)
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 10px",
                border: "none",
                backgroundColor: activeAgent === agent.id ? "rgba(255,255,255,0.06)" : "transparent",
                color: "#e8e8e8",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Bot size={16} style={{ color: agent.color }} />
              {agent.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Session Item
// ============================================================================

interface SessionItemProps {
  id: string
  title: string
  preview?: string
  timestamp?: number
  agentType: "opencode" | "claude-code" | "codex"
  isSelected: boolean
  hasPending?: boolean
  onSelect: () => void
}

function SessionItem({ title, preview, timestamp, agentType, isSelected, hasPending, onSelect }: SessionItemProps) {
  const agentColor = AGENTS.find((a) => a.id === agentType)?.color || "#808080"
  
  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        width: "100%",
        padding: "8px 10px",
        marginLeft: 16,
        borderRadius: 6,
        border: "none",
        backgroundColor: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
        color: "#e8e8e8",
        fontSize: 13,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <MessageCircle size={14} style={{ color: agentColor, marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: 6,
          marginBottom: 2,
        }}>
          <span style={{ 
            flex: 1, 
            overflow: "hidden", 
            textOverflow: "ellipsis", 
            whiteSpace: "nowrap",
            fontWeight: 500,
          }}>
            {truncateText(title, 25)}
          </span>
          {hasPending && (
            <Circle size={6} fill="#f97316" style={{ color: "#f97316", flexShrink: 0 }} />
          )}
          {timestamp && (
            <span style={{ color: "#5c5c5c", fontSize: 11, flexShrink: 0 }}>
              {formatRelativeTime(timestamp)}
            </span>
          )}
        </div>
        {preview && (
          <div style={{ color: "#808080", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {truncateText(preview, 35)}
          </div>
        )}
      </div>
    </button>
  )
}

// ============================================================================
// Project Folder
// ============================================================================

interface ProjectFolderProps {
  path: string
  name: string
  isSelected: boolean
  isExpanded: boolean
  sessions: Array<{
    id: string
    title: string
    preview?: string
    timestamp?: number
    agentType: "opencode" | "claude-code" | "codex"
  }>
  selectedSessionId: string | null
  onToggle: () => void
  onSelect: () => void
  onSessionSelect: (id: string, agentType: "opencode" | "claude-code" | "codex") => void
}

function ProjectFolder({ 
  name, 
  isSelected, 
  isExpanded, 
  sessions, 
  selectedSessionId,
  onToggle, 
  onSelect,
  onSessionSelect,
}: ProjectFolderProps) {
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => {
          onSelect()
          if (!isExpanded) onToggle()
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 8px",
          borderRadius: 6,
          border: "none",
          backgroundColor: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
          color: "#e8e8e8",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {sessions.length > 0 ? (
          isExpanded ? (
            <ChevronDown size={14} style={{ color: "#808080" }} />
          ) : (
            <ChevronRight size={14} style={{ color: "#808080" }} />
          )
        ) : (
          <span style={{ width: 14 }} />
        )}
        <FolderOpen size={14} style={{ color: "#a8a8a8" }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </span>
        {sessions.length > 0 && (
          <span style={{ color: "#5c5c5c", fontSize: 11 }}>{sessions.length}</span>
        )}
      </button>
      
      {isExpanded && sessions.length > 0 && (
        <div style={{ marginTop: 2 }}>
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              id={session.id}
              title={session.title}
              preview={session.preview}
              timestamp={session.timestamp}
              agentType={session.agentType}
              isSelected={selectedSessionId === session.id}
              onSelect={() => onSessionSelect(session.id, session.agentType)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Sidebar
// ============================================================================

interface SidebarProps {
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const send = useConnectionStore((s) => s.send)
  const activeAgent = useConnectionStore((s) => s.activeAgent)
  
  const projects = useProjectsStore((s) => s.projects)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const selectProject = useProjectsStore((s) => s.selectProject)
  
  const openCodeByProject = useSessionsStore((s) => s.openCodeByProject)
  const claudeCodeSessions = useSessionsStore((s) => s.claudeCodeSessions)
  const codexThreads = useSessionsStore((s) => s.codexThreads)
  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const selectSession = useSessionsStore((s) => s.selectSession)
  
  const [expandedProjects, setExpandedProjects] = React.useState<Set<string>>(new Set())
  
  // Request sessions for projects on mount
  const requestedRef = React.useRef(new Set<string>())
  React.useEffect(() => {
    for (const project of projects) {
      if (!requestedRef.current.has(project.path)) {
        requestedRef.current.add(project.path)
        requestAllSessionsForProject(send, project.path)
      }
    }
  }, [projects, send])

  // Get sessions for a project
  const getSessionsForProject = React.useCallback((projectPath: string) => {
    const openCode = openCodeByProject[projectPath] ?? []
    const claudeCode = claudeCodeSessions.filter(
      (s) => s.cwd === projectPath || s.cwd?.startsWith(projectPath + "/")
    )
    const codex = codexThreads.filter(
      (t) => t.cwd === projectPath || t.cwd?.startsWith(projectPath + "/")
    )

    const sessions = [
      ...openCode.map((s) => ({
        id: s.id,
        title: s.title || "Untitled",
        agentType: "opencode" as const,
        timestamp: s.time?.updated,
      })),
      ...claudeCode.map((s) => ({
        id: s.id,
        title: s.title || "Claude Code",
        agentType: "claude-code" as const,
        timestamp: s.updatedAt,
      })),
      ...codex.map((t) => ({
        id: t.id,
        title: t.preview || "Codex",
        agentType: "codex" as const,
        timestamp: t.updatedAt ? t.updatedAt * 1000 : undefined,
      })),
    ]

    sessions.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    return sessions
  }, [openCodeByProject, claudeCodeSessions, codexThreads])

  const handleProjectSelect = (path: string) => {
    selectProject(path)
    send({ type: "set_view", projectPath: path })
  }

  const handleSessionSelect = (id: string, agentType: "opencode" | "claude-code" | "codex", projectPath: string) => {
    if (projectPath !== selectedProjectPath) {
      selectProject(projectPath)
    }
    selectSession(id, agentType)
    
    send({
      type: "set_view",
      projectPath,
      sessionId: id,
      agent: agentType,
    })
    
    // Fetch messages
    if (agentType === "opencode") {
      send({ type: "get_session_messages", sessionId: id, projectPath, limit: 200 } as any)
    } else if (agentType === "claude-code") {
      send({ type: "cc_get_session_messages", sessionId: id, cwd: projectPath, limit: 200 } as any)
    } else if (agentType === "codex") {
      send({ type: "cx_get_thread_messages", threadId: id } as any)
    }
  }

  const handleNewSession = () => {
    if (!selectedProjectPath) return
    
    const requestId = `web_${Date.now()}_${Math.random().toString(16).slice(2)}`
    
    if (activeAgent === "opencode") {
      send({ type: "create_session", projectPath: selectedProjectPath, title: "New Session", requestId } as any)
    } else if (activeAgent === "claude-code") {
      send({ type: "cc_create_session", cwd: selectedProjectPath, requestId } as any)
    } else if (activeAgent === "codex") {
      send({ type: "cx_start_thread", cwd: selectedProjectPath, requestId } as any)
    }
  }

  const toggleProject = (path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <aside
      style={{
        width: 280,
        minWidth: 280,
        height: "100%",
        backgroundColor: "#0f0f0f",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Header */}
      <div style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Close button */}
        {onClose && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: 6,
                borderRadius: 6,
                border: "none",
                backgroundColor: "transparent",
                color: "#808080",
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        
        {/* Agent Selector */}
        <AgentSelector />
        
        {/* New Session Button */}
        <button
          onClick={handleNewSession}
          disabled={!selectedProjectPath}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: "10px",
            borderRadius: 8,
            border: "none",
            backgroundColor: selectedProjectPath ? "#e8e8e8" : "#333",
            color: selectedProjectPath ? "#0f0f0f" : "#666",
            fontSize: 13,
            fontWeight: 600,
            cursor: selectedProjectPath ? "pointer" : "not-allowed",
          }}
        >
          <Plus size={16} />
          New Session
        </button>
      </div>

      {/* Skills Button */}
      <div style={{ padding: "8px 12px" }}>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "transparent",
            color: "#a8a8a8",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Sparkles size={16} />
          Skills
        </button>
      </div>

      {/* Sessions Section */}
      <div style={{ padding: "8px 12px 0" }}>
        <div style={{ 
          fontSize: 11, 
          fontWeight: 600, 
          color: "#5c5c5c", 
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 8,
        }}>
          Sessions
        </div>
      </div>

      {/* Projects List */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 8px" }}>
        {projects.length === 0 ? (
          <div style={{ color: "#5c5c5c", fontSize: 13, padding: "16px 8px", textAlign: "center" }}>
            No projects connected.
            <br />
            <span style={{ fontSize: 12 }}>Start the bridge server to connect.</span>
          </div>
        ) : (
          projects.map((project) => {
            const sessions = getSessionsForProject(project.path)
            return (
              <ProjectFolder
                key={project.path}
                path={project.path}
                name={getProjectName(project.path)}
                isSelected={selectedProjectPath === project.path}
                isExpanded={expandedProjects.has(project.path)}
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onToggle={() => toggleProject(project.path)}
                onSelect={() => handleProjectSelect(project.path)}
                onSessionSelect={(id, agentType) => handleSessionSelect(id, agentType, project.path)}
              />
            )
          })
        )}
      </div>

      {/* Workspace Selector */}
      <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "transparent",
            color: "#e8e8e8",
            fontSize: 13,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              backgroundColor: "rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Building2 size={16} style={{ color: "#a8a8a8" }} />
          </div>
          <span>Broski Workspace</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
