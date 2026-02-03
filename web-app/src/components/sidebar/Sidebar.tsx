import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore, useUnifiedSessionsForProject } from "@/stores/sessions-store"
import { useUiStore } from "@/stores/ui-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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
  const openChat = useWorkspaceStore((s) => s.openChat)
  const openPanel = useWorkspaceStore((s) => s.openPanel)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--sidebar-border)] px-3 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Broski</div>
          {!sidebarCollapsed ? (
            <div className="text-xs text-muted-foreground">
              {wsState === "open" ? "Connected" : wsState}
            </div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="shrink-0"
          aria-label="Toggle sidebar"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!sidebarCollapsed ? (
        <div className="px-3 py-3">
          <Input placeholder="Search…" />
        </div>
      ) : null}

      <div className="flex-1 overflow-auto px-2 pb-3">
        <div className="px-1 py-2">
          {!sidebarCollapsed ? (
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground">
                Projects
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => send({ type: "list_projects" })}
                aria-label="Refresh projects"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          <div className="space-y-1">
            {projects.map((p) => {
              const active = selectedProjectPath === p.path
              return (
                <button
                  key={p.path}
                  className={[
                    "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-[var(--sidebar-item-active)]"
                      : "hover:bg-[var(--sidebar-item-hover)]",
                  ].join(" ")}
                  onClick={() => {
                    selectProject(p.path)
                    send({ type: "set_view", projectPath: p.path })
                    // Pull sessions for this project across backends.
                    send({ type: "list_sessions", projectPath: p.path })
                    send({ type: "cc_list_sessions", cwd: p.path })
                    send({ type: "cx_list_threads", cwd: p.path } as any)
                  }}
                  title={p.path}
                >
                  <div className="truncate">{p.name ?? p.path}</div>
                  {!sidebarCollapsed ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {p.path}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        {!sidebarCollapsed && selectedProjectPath ? (
          <div className="px-1 py-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground">
                Sessions
              </div>
              <Button variant="ghost" size="icon" aria-label="New session">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-1">
              {unifiedSessions.map((s) => {
                const active = selectedSessionId === s.id
                return (
                  <button
                    key={`${s.agentType}:${s.id}`}
                    className={[
                      "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-[var(--sidebar-item-active)]"
                        : "hover:bg-[var(--sidebar-item-hover)]",
                    ].join(" ")}
                    onClick={() => {
                      selectSession(s.id, s.agentType)
                      openChat(s.agentType, s.id)
                      send({
                        type: "set_view",
                        projectPath: selectedProjectPath,
                        sessionId: s.id,
                        agent: s.agentType,
                      })
                      if (s.agentType === "opencode") {
                        send({
                          type: "get_session_messages",
                          sessionId: s.id,
                          projectPath: selectedProjectPath ?? undefined,
                          limit: 200,
                        } as any)
                      } else if (s.agentType === "claude-code") {
                        send({
                          type: "cc_get_session_messages",
                          sessionId: s.id,
                          cwd: selectedProjectPath ?? undefined,
                          limit: 200,
                        } as any)
                      } else if (s.agentType === "codex") {
                        send({ type: "cx_get_thread_messages", threadId: s.id } as any)
                      }
                    }}
                  >
                    <div className="truncate">{s.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.agentType}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {!sidebarCollapsed && selectedProjectPath ? (
          <div className="px-1 py-2">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">
              Workspace
            </div>
            <div className="space-y-1">
              <button
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
                onClick={() => openPanel(`terminal:${selectedProjectPath}`)}
              >
                Terminal
              </button>
              <button
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
                onClick={() => openPanel(`files:${selectedProjectPath}`)}
              >
                Files
              </button>
              <button
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
                onClick={() => openPanel(`git:${selectedProjectPath}`)}
              >
                Git
              </button>
              <button
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
                onClick={() => openPanel(`browser:${selectedProjectPath}`)}
              >
                Preview
              </button>
              <button
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
                onClick={() => openPanel(`spec:${selectedProjectPath}`)}
              >
                Spec
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {!sidebarCollapsed ? (
        <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Agent</div>
            <select
              className="h-8 rounded-md border border-border bg-transparent px-2 text-xs"
              value={activeAgent}
              onChange={(e) => setActiveAgent(e.target.value as any)}
            >
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="opencode">OpenCode</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
  )
}
