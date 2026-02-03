import * as React from "react"

import { DiffBlock } from "@/components/workspace/chat/DiffBlock"

interface DiffViewerProps {
  diff: string
  selectedPath: string | null
  staged: boolean
  onStagedChange: (staged: boolean) => void
}

export const DiffViewer = React.memo<DiffViewerProps>(({
  diff,
  selectedPath,
  staged,
  onStagedChange,
}) => {
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-muted-foreground">
          Diff {selectedPath ? `· ${selectedPath}` : "· (repo)"}
        </div>
        <label className="flex select-none items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={staged}
            onChange={(e) => onStagedChange(e.target.checked)}
          />
          staged
        </label>
      </div>
      
      {diff.trim().length > 0 ? (
        <DiffBlock diff={diff} />
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">
          No diff loaded yet.
        </div>
      )}
    </div>
  )
})

DiffViewer.displayName = "DiffViewer"