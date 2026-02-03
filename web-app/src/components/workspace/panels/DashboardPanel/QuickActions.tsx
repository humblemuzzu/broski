import * as React from "react"

import { Button } from "@/components/ui/button"

interface QuickActionsProps {
  selectedProject?: string | null
  onNewSession?: () => void
}

export const QuickActions = React.memo<QuickActionsProps>(({ 
  selectedProject, 
  onNewSession 
}) => {
  return (
    <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4">
      <div className="text-xs font-semibold text-muted-foreground mb-3">
        Quick Actions
      </div>
      <div className="space-y-2">
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full"
          disabled={!selectedProject}
          onClick={onNewSession}
        >
          New Session
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full"
          disabled={!selectedProject}
        >
          Open Terminal
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full"
          disabled={!selectedProject}
        >
          Browse Files
        </Button>
      </div>
    </div>
  )
})

QuickActions.displayName = "QuickActions"