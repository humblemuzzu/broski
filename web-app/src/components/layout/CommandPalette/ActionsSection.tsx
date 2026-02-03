import * as React from "react"

import { CommandPaletteItem } from "./CommandPaletteItem"

type ActionItem = {
  id: string
  label: string
  hint?: string
  run: () => void
}

interface ActionsSectionProps {
  actions: ActionItem[]
  onSelect: (action: ActionItem) => void
}

export const ActionsSection = React.memo<ActionsSectionProps>(({ 
  actions, 
  onSelect 
}) => {
  if (actions.length === 0) return null

  return (
    <div className="mb-3">
      <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
        Actions
      </div>
      <div className="space-y-1">
        {actions.slice(0, 8).map((action) => (
          <CommandPaletteItem
            key={action.id}
            label={action.label}
            hint={action.hint}
            onSelect={() => onSelect(action)}
          />
        ))}
      </div>
    </div>
  )
})

ActionsSection.displayName = "ActionsSection"