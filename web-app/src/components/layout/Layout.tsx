import * as React from "react"
import { PanelRight } from "lucide-react"

import { AppSidebar } from "@/components/sidebar/AppSidebar"
import { RightPanel } from "@/components/right-panel/RightPanel"
import { TilingWorkspace } from "@/components/workspace/TilingWorkspace"
import { CommandPalette } from "@/components/layout/CommandPalette"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { useUiStore } from "@/stores/ui-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useConnectionStore } from "@/stores/connection-store"

export function Layout() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const setActiveProjectKey = useWorkspaceStore((s) => s.setActiveProjectKey)
  const activeAgent = useConnectionStore((s) => s.activeAgent)

  React.useEffect(() => {
    setActiveProjectKey(selectedProjectPath)
  }, [selectedProjectPath, setActiveProjectKey])

  return (
    <SidebarProvider
      defaultOpen={!sidebarCollapsed}
      open={!sidebarCollapsed}
      onOpenChange={(open) => setSidebarCollapsed(!open)}
      className="min-h-screen"
    >
      <CommandPalette />
      
      <AppSidebar />
      
      <SidebarInset className="flex flex-col">
        {/* Top header bar */}
        <header 
          className="flex h-12 shrink-0 items-center justify-between border-b px-4"
          style={{ 
            backgroundColor: '#0f0f0f', 
            borderColor: 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ color: '#808080', fontSize: '14px' }}>
              {activeAgent === 'opencode' ? 'OpenCode' : activeAgent === 'claude-code' ? 'Claude Code' : 'Codex'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleRightPanel}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors"
              style={{ 
                color: rightPanelOpen ? '#e8e8e8' : '#808080',
                backgroundColor: rightPanelOpen ? 'rgba(255,255,255,0.06)' : 'transparent'
              }}
              title={rightPanelOpen ? 'Hide panel' : 'Show panel'}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Main workspace area */}
          <div 
            className="relative min-w-0 flex-1"
            style={{ backgroundColor: '#0f0f0f' }}
          >
            <TilingWorkspace />
          </div>

          {/* Right panel - slides in */}
          {rightPanelOpen && (
            <div 
              className="h-full w-[320px] shrink-0"
              style={{ 
                backgroundColor: '#0f0f0f', 
                borderLeft: '1px solid rgba(255,255,255,0.06)' 
              }}
            >
              <RightPanel />
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
