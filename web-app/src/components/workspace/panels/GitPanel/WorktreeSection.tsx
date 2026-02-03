import * as React from "react"
import { Plus, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WorktreeCard } from "./WorktreeCard"

interface WorktreeSectionProps {
  worktrees: any[]
  newWorktreeName: string
  onNewWorktreeNameChange: (name: string) => void
  onCreateWorktree: () => void
  onDeleteWorktree: (name: string) => void
  onRefresh: () => void
}

export const WorktreeSection = React.memo<WorktreeSectionProps>(({
  worktrees,
  newWorktreeName,
  onNewWorktreeNameChange,
  onCreateWorktree,
  onDeleteWorktree,
  onRefresh,
}) => {
  return (
    <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground">
          Worktrees ({worktrees.length})
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          List
        </Button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Input
          value={newWorktreeName}
          onChange={(e) => onNewWorktreeNameChange(e.target.value)}
          placeholder="new worktree name"
        />
        <Button
          size="icon"
          variant="outline"
          aria-label="Create worktree"
          onClick={onCreateWorktree}
          disabled={!newWorktreeName.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 space-y-1">
        {worktrees.map((w: any) => (
          <WorktreeCard
            key={w.name ?? w.path ?? Math.random()}
            worktree={w}
            onSelect={() => {
              // Navigate to worktree functionality can be added here
            }}
            onDelete={w.name ? () => onDeleteWorktree(w.name) : undefined}
          />
        ))}
        {worktrees.length === 0 && (
          <div className="text-sm text-muted-foreground">None.</div>
        )}
      </div>
    </div>
  )
})

WorktreeSection.displayName = "WorktreeSection"