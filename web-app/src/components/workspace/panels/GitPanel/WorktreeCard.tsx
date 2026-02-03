import * as React from "react"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface WorktreeCardProps {
  worktree: { path: string; branch: string; isMain: boolean; name?: string }
  onSelect: () => void
  onDelete?: () => void
}

export const WorktreeCard = React.memo<WorktreeCardProps>(({ 
  worktree, 
  onSelect, 
  onDelete 
}) => {
  return (
    <div
      className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
      onClick={onSelect}
    >
      <div className="min-w-0">
        <div className="truncate font-semibold">{worktree.name ?? "worktree"}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {worktree.path ?? ""}
        </div>
      </div>
      {worktree.name && onDelete && (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Delete worktree"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  )
})

WorktreeCard.displayName = "WorktreeCard"