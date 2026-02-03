import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore, useUnifiedSessionsForProject } from "@/stores/sessions-store"
import { useUiStore } from "@/stores/ui-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { requestAllProjects, requestAllSessionsForProject } from "@/core/bootstrap"
import { Input } from "@/components/ui/input"

import { SidebarHeader } from "./SidebarHeader"
import { ProjectList } from "./ProjectList"
import { SessionList } from "./SessionList"
import { WorkspaceNav } from "./WorkspaceNav"
import { AgentSelector } from "./AgentSelector"

export function Sidebar() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  const wsState = useConnectionStore((s) => s.wsState)
  const activeAgent = useConnectionStore((s) => s.activeAgent)
  const setActiveAgent = useConnectionStore((s) => s.setActiveAgent)
  const send = useConnectionStore((s) => s.send)

  const projects = useProjectsStore((s) => s.projects)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const selectProject = useProjectsStore((s) => s.selectProject)

  const unifiedSessions = useUnifiedSessionsForProject(selectedProjectPath)
  const selectSession = useSessionsStore((s) => s.selectSession)
  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const setPendingCreate = useSessionsStore((s) => s.setPendingCreate)
  const openChat = useWorkspaceStore((s) => s.openChat)
  const openPanel = useWorkspaceStore((s) => s.openPanel)

  const handleProjectSelect = (path: string) => {
    selectProject(path)
    send({ type: "set_view", projectPath: path })
    // Pull sessions for this project from ALL 3 backends (OpenCode, Claude Code, Codex)
    requestAllSessionsForProject(send, path)
  }

  const handleSessionSelect = (id: string, agentType: string) => {
    selectSession(id, agentType as "opencode" | "claude-code" | "codex")
    openChat(agentType, id)
    send({
      type: "set_view",
      projectPath: selectedProjectPath ?? undefined,
      sessionId: id,
      agent: agentType as "opencode" | "claude-code" | "codex",
    })
    if (agentType === "opencode") {
      send({
        type: "get_session_messages",
        sessionId: id,
        projectPath: selectedProjectPath ?? undefined,
        limit: 200,
      } as any)
    } else if (agentType === "claude-code") {
      send({
        type: "cc_get_session_messages",
        sessionId: id,
        cwd: selectedProjectPath ?? undefined,
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

  return (
    <div className="flex h-full flex-col">
      <SidebarHeader
        collapsed={sidebarCollapsed}
        wsState={wsState}
        onToggle={toggleSidebar}
      />

      {!sidebarCollapsed ? (
        <div className="px-3 py-3">
          <Input placeholder="Search…" />
        </div>
      ) : null}

      <div className="flex-1 overflow-auto px-2 pb-3">
        <ProjectList
          projects={projects}
          selectedPath={selectedProjectPath}
          collapsed={sidebarCollapsed}
          onSelectProject={handleProjectSelect}
          onRefresh={() => requestAllProjects(send)}
        />

        {!sidebarCollapsed && selectedProjectPath ? (
          <SessionList
            sessions={unifiedSessions}
            selectedId={selectedSessionId}
            onSelectSession={handleSessionSelect}
            onCreateSession={handleCreateSession}
          />
        ) : null}

        {!sidebarCollapsed && selectedProjectPath ? (
          <WorkspaceNav
            projectPath={selectedProjectPath}
            onOpenPanel={openPanel}
          />
        ) : null}
      </div>

      {!sidebarCollapsed ? (
        <AgentSelector
          value={activeAgent}
          onChange={setActiveAgent}
        />
      ) : null}
    </div>
  )
}
