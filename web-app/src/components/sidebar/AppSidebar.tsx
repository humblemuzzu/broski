import * as React from "react"
import {
  ChevronDown,
  ChevronRight,
  Filter,
  FolderOpen,
  LayoutGrid,
  PenSquare,
  Settings,
  Sparkles,
  Timer,
  Shield,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { usePermissionsStore } from "@/stores/permissions-store"
import { useChatStore } from "@/stores/chat-store"
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

export function AppSidebar() {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"
  
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

  // Track expanded projects
  const [expandedProjects, setExpandedProjects] = React.useState<Set<string>>(new Set())

  // Request sessions for projects
  const requestedProjectSessionsRef = React.useRef(new Set<string>())
  React.useEffect(() => {
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

    sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return sessions
  }

  const hasPendingForSession = (id: string, agentType: string) => {
    if (agentType === "claude-code") return (ccPermissions[id]?.length ?? 0) > 0
    if (agentType === "codex") {
      return (codexApprovals[id]?.length ?? 0) > 0 || (codexUserInputs[id]?.length ?? 0) > 0
    }
    return false
  }

  const toggleProject = (path: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <Sidebar collapsible="icon" style={{ backgroundColor: '#0f0f0f', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
      <SidebarHeader className="p-3">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <span className="text-sm font-medium text-sidebar-foreground/70">Broski</span>
          )}
          <SidebarTrigger className="text-sidebar-foreground/50 hover:text-sidebar-foreground" />
        </div>
      </SidebarHeader>
      
      <SidebarContent className="px-2">
        {/* Primary nav */}
        <SidebarGroup className="py-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={handleCreateSession}
                tooltip="New thread"
              >
                <PenSquare className="h-4 w-4" />
                <span>New thread</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={() => openPanel(`automations:${selectedProjectPath ?? ""}`)}
                tooltip="Automations"
              >
                <Timer className="h-4 w-4" />
                <span>Automations</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={() => openPanel(`skills:${selectedProjectPath ?? ""}`)}
                tooltip="Skills"
              >
                <Sparkles className="h-4 w-4" />
                <span>Skills</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <Separator className="my-2 bg-sidebar-border" />

        {/* Threads section */}
        <SidebarGroup className="flex-1 py-0">
          <SidebarGroupLabel className="flex items-center justify-between px-2">
            <span>Threads</span>
            {!isCollapsed && (
              <div className="flex items-center gap-1">
                <button className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground">
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground">
                  <Filter className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </SidebarGroupLabel>
          
          <SidebarGroupContent>
            <ScrollArea className="h-full">
              <SidebarMenu>
                {projects.map((project) => {
                  const projectName = project.name ?? project.path.split("/").pop() ?? project.path
                  const sessions = getSessionsForProject(project.path)
                  const isExpanded = expandedProjects.has(project.path)
                  const isSelected = selectedProjectPath === project.path
                  
                  return (
                    <Collapsible
                      key={project.path}
                      open={isExpanded}
                      onOpenChange={() => toggleProject(project.path)}
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={isSelected}
                            onClick={() => {
                              handleProjectSelect(project.path)
                              if (!isExpanded) toggleProject(project.path)
                            }}
                            tooltip={projectName}
                          >
                            <FolderOpen className="h-4 w-4" />
                            <span className="truncate">{projectName}</span>
                            {sessions.length > 0 && (
                              <ChevronRight 
                                className={`ml-auto h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              />
                            )}
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        
                        {sessions.length > 0 && (
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {sessions.slice(0, 10).map((session) => {
                                const isSessionSelected = selectedSessionId === session.id
                                const hasPending = hasPendingForSession(session.id, session.agentType)
                                const chatKey = `${session.agentType}:${session.id}`
                                const preview = getPreviewFromMessages((chatsBySession as any)?.[chatKey])
                                const displayTitle = session.title.length > 30 
                                  ? session.title.slice(0, 30) + "..." 
                                  : session.title
                                
                                return (
                                  <SidebarMenuSubItem key={`${session.agentType}:${session.id}`}>
                                    <SidebarMenuSubButton
                                      isActive={isSessionSelected}
                                      onClick={() => handleSessionSelect(session.id, session.agentType, project.path)}
                                      className="flex-col items-start gap-0 py-2"
                                    >
                                      <div className="flex w-full items-center justify-between">
                                        <span className="truncate text-sm font-medium">
                                          {displayTitle}
                                        </span>
                                        {hasPending && (
                                          <Badge variant="destructive" className="h-4 w-4 p-0 text-[10px] flex items-center justify-center">
                                            !
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex w-full items-center justify-between text-xs text-sidebar-foreground/50">
                                        <span className="truncate max-w-[140px]">
                                          {preview || session.agentType}
                                        </span>
                                        <span className="shrink-0 ml-2">
                                          {formatRelativeTime(session.updatedAt)}
                                        </span>
                                      </div>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )
                              })}
                              
                              {sessions.length > 10 && (
                                <SidebarMenuSubItem>
                                  <SidebarMenuSubButton className="text-xs text-sidebar-foreground/50">
                                    Show {sessions.length - 10} more
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              )}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        )}
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                })}
              </SidebarMenu>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Broski Workspace">
              <Shield className="h-4 w-4" />
              <span className="truncate">Broski Workspace</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
