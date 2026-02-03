import * as React from "react"
import "react-mosaic-component/react-mosaic-component.css"

import { Mosaic, MosaicWindow, type MosaicNode } from "react-mosaic-component"
import { LayoutGrid } from "lucide-react"

import { useWorkspaceStore } from "@/stores/workspace-store"
import { PanelRenderer } from "@/components/workspace/panels/PanelRenderer"

function stripInstanceSuffix(panelId: string): string {
  const idx = panelId.indexOf("#")
  return idx === -1 ? panelId : panelId.slice(0, idx)
}

function titleForPanel(panelId: string): string {
  const baseId = stripInstanceSuffix(panelId)
  if (baseId === "dashboard") return "Dashboard"
  if (baseId.startsWith("new:")) return "New Panel"
  if (baseId.startsWith("chat:")) return "Chat"
  if (baseId.startsWith("terminal:")) return "Terminal"
  if (baseId.startsWith("files:")) return "Files"
  if (baseId.startsWith("git:")) return "Git"
  if (baseId.startsWith("browser:")) return "Preview"
  if (baseId.startsWith("spec:")) return "Spec"
  if (baseId.startsWith("automation:")) return "Automation"
  if (baseId.startsWith("integrations:")) return "Integrations"
  if (baseId.startsWith("collab:")) return "Multi-Agent"
  return baseId
}

export function TilingWorkspace() {
  const layout = useWorkspaceStore((s) => s.layout)
  const setLayout = useWorkspaceStore((s) => s.setLayout)

  const renderTile = React.useCallback(
    (id: string, path: Array<"first" | "second">) => {
      return (
        <MosaicWindow<string>
          path={path}
          title={titleForPanel(id)}
          createNode={() => `new:${Math.random().toString(16).slice(2)}`}
          className="!bg-[var(--panel)] !text-foreground"
        >
          <div className="h-full w-full overflow-hidden">
            <PanelRenderer panelId={id} path={path} />
          </div>
        </MosaicWindow>
      )
    },
    []
  )

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-[var(--panel-header)] px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          Workspace
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <Mosaic<string>
          value={layout as MosaicNode<string>}
          onChange={(next) => setLayout(next as MosaicNode<string> | null)}
          renderTile={renderTile}
          className="mosaic-blueprint-theme"
        />
      </div>
    </div>
  )
}
