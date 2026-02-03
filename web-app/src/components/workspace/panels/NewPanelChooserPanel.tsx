import * as React from "react"
import { MosaicContext, type MosaicBranch } from "react-mosaic-component"

import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { Button } from "@/components/ui/button"

function stripInstanceSuffix(panelId: string): string {
  const idx = panelId.indexOf("#")
  return idx === -1 ? panelId : panelId.slice(0, idx)
}

export function NewPanelChooserPanel({
  path,
  panelId,
}: {
  path: Array<MosaicBranch>
  panelId: string
}) {
  const ctx = React.useContext(MosaicContext)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const selectedSessionAgent = useSessionsStore((s) => s.selectedSessionAgent)

  const replaceWith = (next: string) => {
    ctx.mosaicActions.replaceWith(path, next)
    // Best-effort: if the placeholder had an instance suffix, also try to remove it from tree
    // by replacing itself (already done). No extra cleanup needed.
  }

  const project = selectedProjectPath ?? ""
  const items: Array<{ id: string; label: string; disabled?: boolean }> = [
    { id: "dashboard", label: "Dashboard" },
    { id: `terminal:${project}`, label: "Terminal", disabled: !project },
    { id: `files:${project}`, label: "Files", disabled: !project },
    { id: `git:${project}`, label: "Git", disabled: !project },
    { id: `browser:${project}`, label: "Preview", disabled: !project },
    { id: `spec:${project}`, label: "Spec", disabled: !project },
    { id: `automation:${project}`, label: "Automation", disabled: !project },
    { id: `integrations:${project}`, label: "Integrations", disabled: !project },
  ]

  if (selectedSessionId && selectedSessionAgent) {
    items.unshift({
      id: `chat:${selectedSessionAgent}:${selectedSessionId}`,
      label: `Chat (${selectedSessionAgent})`,
    })
    if (selectedSessionAgent === "codex") {
      items.unshift({
        id: `collab:${selectedSessionId}`,
        label: "Multi-Agent (Codex)",
      })
    }
  }

  return (
    <div className="h-full w-full p-4">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <div className="text-sm font-semibold">New Panel</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Replace <span className="font-mono">{stripInstanceSuffix(panelId)}</span>{" "}
          with:
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {items.map((i) => (
            <Button
              key={i.id}
              size="sm"
              variant="outline"
              disabled={i.disabled}
              onClick={() => replaceWith(i.id)}
            >
              {i.label}
            </Button>
          ))}
        </div>

        {!selectedProjectPath ? (
          <div className="mt-3 text-xs text-muted-foreground">
            Tip: select a project in the sidebar to enable project panels.
          </div>
        ) : null}
      </div>
    </div>
  )
}
