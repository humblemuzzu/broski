import * as React from "react"
import "react-mosaic-component/react-mosaic-component.css"

import { Mosaic, MosaicWindow, type MosaicNode } from "react-mosaic-component"

import { useWorkspaceStore } from "@/stores/workspace-store"
import { PanelRenderer } from "@/components/workspace/panels/PanelRenderer"

export function TilingWorkspace() {
  const layout = useWorkspaceStore((s) => s.layout)
  const setLayout = useWorkspaceStore((s) => s.setLayout)

  const renderTile = React.useCallback(
    (id: string, path: Array<"first" | "second">) => {
      return (
        <MosaicWindow<string>
          path={path}
          title=""
          createNode={() => `new:${Math.random().toString(16).slice(2)}`}
          className="!rounded-none !shadow-none"
          renderToolbar={() => <div className="hidden" />}
        >
          <div className="h-full w-full overflow-hidden bg-[var(--background)]">
            <PanelRenderer panelId={id} path={path} />
          </div>
        </MosaicWindow>
      )
    },
    []
  )

  return (
    <div className="h-full w-full">
      <Mosaic<string>
        value={layout as MosaicNode<string>}
        onChange={(next) => setLayout(next as MosaicNode<string> | null)}
        renderTile={renderTile}
        className="mosaic-blueprint-theme"
      />
    </div>
  )
}
