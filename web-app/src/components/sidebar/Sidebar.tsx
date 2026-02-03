import { useEffect, useRef, useState } from "react"
import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { usePermissionsStore } from "@/stores/permissions-store"
import { useChatStore } from "@/stores/chat-store"
import { useUiStore } from "@/stores/ui-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { requestAllSessionsForProject } from "@/core/bootstrap"

// Relative time formatting
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

function normalizePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function getPreviewFromMessages(messages: Array<{ role?: string; text?: string }> | undefined): string {
  if (!messages || messages.length === 0) return ""
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (msg.role === "system") continue
    const text = typeof msg.text === "string" ? normalizePreviewText(msg.text) : ""
    if (!text) continue
    return text
  }
  return ""
}

// Clean SVG icons matching the reference style
function NewThreadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

function AutomationsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function SkillsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
      <path d="M12 22v-9" />
      <path d="M20 6.5l-8 4.5-8-4.5" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function SplitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="8" y1="18" x2="16" y2="18" />
    </svg>
  )
}

function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  )
}

function WorkspaceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

export function Sidebar() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  const activeAgent = useConnectionStore((s) => s.activeAgent)
  const send = useConnectionStore((s) => s.send)

  const projects = useProjectsStore((s) => s.projects)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const selectProject = useProjectsStore((s) => s.selectProject)

  const openCodeByProject = useSessionsStore((s) => s.openCodeByProject)
  const claudeCodeSessions = useSessionsStore((s) => s.claudeCodeSessions)
  const codexThreads = useSessionsStore((s) => s.codexThreads)

  const selectSession = useSessionsStore((s) => s.selectSession)
  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const setPendingCreate = useSessionsStore((s) => s.setPendingCreate)
  const openChat = useWorkspaceStore((s) => s.openChat)
  const openPanel = useWorkspaceStore((s) => s.openPanel)

  const ccPermissions = usePermissionsStore((s) => s.claudeCode)
  const codexApprovals = usePermissionsStore((s) => s.codexApprovals)
  const codexUserInputs = usePermissionsStore((s) => s.codexUserInputs)

  const chatsBySession = useChatStore((s) => s.bySession)

  // Track "show more" state per project
  const [showAllThreads, setShowAllThreads] = useState<Record<string, boolean>>({})
  const THREADS_PREVIEW_COUNT = 10

  // OpenCode requires per-project session listing. Prefetch sessions for all projects
  // as they appear so the sidebar can render threads immediately.
  const requestedProjectSessionsRef = useRef(new Set<string>())
  useEffect(() => {
    for (const project of projects) {
      const path = project.path
      if (!path) continue
      if (requestedProjectSessionsRef.current.has(path)) continue
      requestedProjectSessionsRef.current.add(path)
      send({ type: "list_sessions", projectPath: path } as any)
    }
  }, [projects, send])

  const handleProjectSelect = (path: string) => {
    selectProject(path)
    send({ type: "set_view", projectPath: path })
    requestAllSessionsForProject(send, path)
  }

  const handleSessionSelect = (id: string, agentType: string, projectPath: string) => {
    // Keep project selection in sync when selecting a thread from the global list.
    if (projectPath && projectPath !== selectedProjectPath) {
      selectProject(projectPath)
    }
    selectSession(id, agentType as "opencode" | "claude-code" | "codex")
    openChat(agentType, id)
    
    send({
      type: "set_view",
      projectPath: projectPath || undefined,
      sessionId: id,
      agent: agentType as "opencode" | "claude-code" | "codex",
    })
    if (agentType === "opencode") {
      send({
        type: "get_session_messages",
        sessionId: id,
        projectPath: projectPath || undefined,
        limit: 200,
      } as any)
    } else if (agentType === "claude-code") {
      send({
        type: "cc_get_session_messages",
        sessionId: id,
        cwd: projectPath || undefined,
        limit: 200,
      } as any)
    } else if (agentType === "codex") {
      send({ type: "cx_get_thread_messages", threadId: id } as any)
    }
  }

  const handleCreateSession = () => {
    if (!selectedProjectPath) return
    const requestId = `web_${Date.now()}_${Math.random().toString(16).slice(2)}`
    setPendingCreate({
      requestId,
      agent: activeAgent,
      projectPath: selectedProjectPath,
    })
    if (activeAgent === "opencode") {
      send({
        type: "create_session",
        projectPath: selectedProjectPath,
        title: "New Session",
        requestId,
      } as any)
      send({ type: "list_sessions", projectPath: selectedProjectPath, requestId: `${requestId}:list` } as any)
    } else if (activeAgent === "claude-code") {
      send({ type: "cc_create_session", cwd: selectedProjectPath, requestId } as any)
      send({ type: "cc_list_sessions", cwd: selectedProjectPath, requestId: `${requestId}:list` } as any)
    } else if (activeAgent === "codex") {
      send({ type: "cx_start_thread", cwd: selectedProjectPath, requestId } as any)
      send({ type: "cx_list_threads", cwd: selectedProjectPath, requestId: `${requestId}:list` } as any)
    }
  }

  // Get sessions for a specific project
  const getSessionsForProject = (projectPath: string) => {
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
        cwd: s.directory,
        updatedAt: s.time?.updated,
      })),
      ...claudeCode.map((s) => ({
        id: s.id,
        title: s.title || "Claude Code",
        agentType: "claude-code" as const,
        cwd: s.cwd,
        updatedAt: s.updatedAt,
      })),
      ...codex.map((t) => ({
        id: t.id,
        title: t.preview || "Codex",
        agentType: "codex" as const,
        cwd: t.cwd,
        updatedAt: t.updatedAt ? t.updatedAt * 1000 : undefined,
      })),
    ]

    // Sort by updatedAt, most recent first
    sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return sessions
  }

  // Prefetch a small amount of transcript/messages for visible sessions so we
  // can show the ChatGPT-style "preview snippet" line in the sidebar.
  const requestedPreviewRef = useRef(new Set<string>())
  useEffect(() => {
    for (const project of projects) {
      const sessions = getSessionsForProject(project.path)
      const showingAll = showAllThreads[project.path] ?? false
      const visible = showingAll ? sessions : sessions.slice(0, THREADS_PREVIEW_COUNT)

      for (const session of visible) {
        const chatKey = `${session.agentType}:${session.id}`
        if (requestedPreviewRef.current.has(chatKey)) continue

        const existing = (chatsBySession as any)?.[chatKey]
        if (Array.isArray(existing) && existing.length > 0) {
          requestedPreviewRef.current.add(chatKey)
          continue
        }

        // Only prefetch for backends where we can request a limited window.
        if (session.agentType === "opencode") {
          requestedPreviewRef.current.add(chatKey)
          send({
            type: "get_session_messages",
            sessionId: session.id,
            projectPath: session.cwd ?? project.path,
            limit: 20,
          } as any)
          continue
        }

        if (session.agentType === "claude-code") {
          requestedPreviewRef.current.add(chatKey)
          send({
            type: "cc_get_session_messages",
            sessionId: session.id,
            cwd: session.cwd ?? project.path,
            limit: 20,
          } as any)
          continue
        }
      }
    }
  }, [chatsBySession, projects, send, showAllThreads, openCodeByProject, claudeCodeSessions, codexThreads])

  const hasPendingForSession = (id: string, agentType: string) => {
    if (agentType === "claude-code") return (ccPermissions[id]?.length ?? 0) > 0
    if (agentType === "codex") {
      return (codexApprovals[id]?.length ?? 0) > 0 || (codexUserInputs[id]?.length ?? 0) > 0
    }
    return false
  }

  // Collapsed state
  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col h-full py-3 px-2 bg-[var(--sidebar-bg)]">
        <button
          onClick={toggleSidebar}
          className="ml-auto p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors"
          aria-label="Expand sidebar"
        >
          <SidebarToggleIcon className="w-5 h-5" />
        </button>

        <div className="mt-2 flex flex-col gap-1">
          <button
            onClick={handleCreateSession}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors"
            aria-label="New thread"
          >
            <NewThreadIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => openPanel(`automations:${selectedProjectPath ?? ""}`)}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors"
            aria-label="Automations"
          >
            <AutomationsIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => openPanel(`skills:${selectedProjectPath ?? ""}`)}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors"
            aria-label="Skills"
          >
            <SkillsIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-auto">
          <button
            className="w-full p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors"
            aria-label="Workspace"
          >
            <WorkspaceIcon className="w-5 h-5 mx-auto" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--sidebar-bg)]">
      {/* Top row with toggle */}
      <div className="flex items-center justify-end px-4 py-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors"
          aria-label="Toggle sidebar"
        >
          <SidebarToggleIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Primary nav */}
      <div className="px-3 space-y-0.5">
        <button
          onClick={handleCreateSession}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors text-left"
        >
          <NewThreadIcon className="w-[18px] h-[18px]" />
          <span className="text-[15px]">New thread</span>
        </button>

        <button
          onClick={() => openPanel(`automations:${selectedProjectPath ?? ""}`)}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors text-left"
        >
          <AutomationsIcon className="w-[18px] h-[18px]" />
          <span className="text-[15px]">Automations</span>
        </button>

        <button
          onClick={() => openPanel(`skills:${selectedProjectPath ?? ""}`)}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors text-left"
        >
          <SkillsIcon className="w-[18px] h-[18px]" />
          <span className="text-[15px]">Skills</span>
        </button>
      </div>

      {/* Threads section */}
      <div className="mt-4 flex-1 overflow-y-auto min-h-0">
        {/* Section header */}
        <div className="flex items-center justify-between px-6 mb-2">
          <span className="text-[13px] text-[var(--text-muted)]">Threads</span>
          <div className="flex items-center gap-2">
            <button className="p-0.5 text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">
              <SplitIcon className="w-4 h-4" />
            </button>
            <button className="p-0.5 text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">
              <FilterIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Projects with threads */}
        <div className="px-3">
          {projects.map((project) => {
            const projectName = project.name ?? project.path.split("/").pop() ?? project.path
            const sessions = getSessionsForProject(project.path)
            const shouldShowMore = sessions.length > THREADS_PREVIEW_COUNT
            const showingAll = showAllThreads[project.path] ?? false
            const displaySessions = showingAll 
              ? sessions 
              : sessions.slice(0, THREADS_PREVIEW_COUNT)
            
            return (
              <div key={project.path} className="mb-1">
                {/* Project name row */}
                <button
                  onClick={() => handleProjectSelect(project.path)}
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors ${
                    selectedProjectPath === project.path 
                      ? "bg-[var(--sidebar-item-selected)] text-[var(--text)]" 
                      : "text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--sidebar-item-hover)]"
                  }`}
                >
                  <FolderIcon className="w-[18px] h-[18px] text-[var(--text-faint)] flex-shrink-0" />
                  <span className="text-[15px] truncate">{projectName}</span>
                </button>

                {/* Threads under this project */}
                {sessions.length > 0 && (
                  <div className="mt-0.5">
                    {displaySessions.map((session) => {
                      const isSelected = selectedSessionId === session.id
                      const hasPending = hasPendingForSession(session.id, session.agentType)
                      const title =
                        session.title.length > 42
                          ? session.title.slice(0, 42) + "..."
                          : session.title
                      const subtitle =
                        session.agentType === "claude-code"
                          ? "Claude"
                          : session.agentType === "codex"
                            ? "Codex"
                            : "OpenCode"
                      const chatKey = `${session.agentType}:${session.id}`
                      const preview = getPreviewFromMessages((chatsBySession as any)?.[chatKey]) || subtitle

                      return (
                        <button
                          key={`${session.agentType}:${session.id}`}
                          onClick={() => handleSessionSelect(session.id, session.agentType, project.path)}
                          className={[
                            "w-full rounded-lg pl-8 pr-3 py-2 text-left transition-colors",
                            isSelected
                              ? "bg-[var(--sidebar-item-selected)] text-[var(--text)]"
                              : "text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--sidebar-item-hover)]",
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-medium truncate flex-1">
                              {title}
                            </span>
                            {hasPending && (
                              <span className="h-4 w-4 rounded-full bg-[var(--error)] text-white text-[10px] font-bold flex items-center justify-center">
                                !
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-3">
                            <span className="text-[12px] text-[var(--text-muted)] truncate">
                              {preview}
                            </span>
                            <span className="text-[12px] text-[var(--text-faint)] flex-shrink-0">
                              {formatRelativeTime(session.updatedAt)}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                    
                    {/* Show more */}
                    {shouldShowMore && (
                      <button
                        onClick={() => setShowAllThreads(prev => ({ 
                          ...prev, 
                          [project.path]: !showingAll 
                        }))}
                        className="w-full pl-8 pr-3 py-1 text-left text-[13px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
                      >
                        {showingAll 
                          ? "Show less" 
                          : `Show more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom workspace */}
      <div className="px-3 py-3">
        <button className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors">
          <WorkspaceIcon className="w-[18px] h-[18px] flex-shrink-0" />
          <span className="text-[14px] flex-1 text-left truncate">Broski Workspace</span>
        </button>
      </div>
    </div>
  )
}
