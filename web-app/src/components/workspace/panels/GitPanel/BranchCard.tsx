import * as React from "react"

interface BranchCardProps {
  branch: string
  remote?: string
  ahead?: number
  behind?: number
}

export const BranchCard = React.memo<BranchCardProps>(({ 
  branch, 
  remote, 
  ahead, 
  behind 
}) => {
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">Branch</div>
      <div className="mt-2 text-sm font-semibold">{branch ?? "—"}</div>
      {remote && (
        <div className="mt-1 text-xs text-muted-foreground">
          Remote: {remote}
        </div>
      )}
      {(ahead || behind) && (
        <div className="mt-1 text-xs text-muted-foreground">
          {ahead ? `↑${ahead}` : ""} {behind ? `↓${behind}` : ""}
        </div>
      )}
    </div>
  )
})

BranchCard.displayName = "BranchCard"