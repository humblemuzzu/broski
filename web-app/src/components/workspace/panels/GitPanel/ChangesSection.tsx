import * as React from "react"

import { Button } from "@/components/ui/button"
import { FileChangeItem } from "./FileChangeItem"

interface ChangesSectionProps {
  fileStatus: any[]
  selectedPath: string | null
  onFileSelect: (path: string) => void
  onRepoDiff: () => void
}

export const ChangesSection = React.memo<ChangesSectionProps>(({
  fileStatus,
  selectedPath,
  onFileSelect,
  onRepoDiff,
}) => {
  return (
    <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground">
          Changes ({fileStatus.length})
        </div>
        <Button size="sm" variant="outline" onClick={onRepoDiff}>
          Repo Diff
        </Button>
      </div>
      
      <div className="mt-3 space-y-1">
        {fileStatus.map((f, idx) => (
          <FileChangeItem
            key={`${f.path ?? "file"}:${idx}`}
            file={f}
            isSelected={selectedPath === f.path}
            onSelect={() => onFileSelect(f.path)}
          />
        ))}
        {fileStatus.length === 0 && (
          <div className="text-sm text-muted-foreground">Clean.</div>
        )}
      </div>
    </div>
  )
})

ChangesSection.displayName = "ChangesSection"