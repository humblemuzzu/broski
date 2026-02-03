import * as React from "react"

import { Sidebar } from "@/components/sidebar/Sidebar"
import { RightPanel } from "@/components/right-panel/RightPanel"
import { TilingWorkspace } from "@/components/workspace/TilingWorkspace"
import { useUiStore } from "@/stores/ui-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useWorkspaceStore } from "@/stores/workspace-store"

export function Layout() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const setActiveProjectKey = useWorkspaceStore((s) => s.setActiveProjectKey)

  React.useEffect(() => {
    setActiveProjectKey(selectedProjectPath)
  }, [selectedProjectPath, setActiveProjectKey])

  return (
    <div className="h-screen w-screen overflow-hidden" style={{ background: "var(--background)" }}>
      <div className="flex h-full w-full">
        <div
          className={[
            "h-full shrink-0 border-r",
            "border-[var(--sidebar-border)] bg-[var(--sidebar)]",
            sidebarCollapsed ? "w-[64px]" : "w-[280px]",
          ].join(" ")}
          style={{ minHeight: "100vh" }}
        >
          <Sidebar />
        </div>

        <div className="relative min-w-0 flex-1" style={{ background: "var(--background)" }}>
          <TilingWorkspace />
        </div>

        {rightPanelOpen ? (
          <div className="h-full w-[340px] shrink-0 border-l border-border bg-card">
            <RightPanel />
          </div>
        ) : null}
      </div>
    </div>
  )
}
