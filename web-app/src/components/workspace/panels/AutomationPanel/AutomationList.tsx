import * as React from "react"
import { AutomationItem } from "./AutomationItem"

interface AutomationListProps {
  items: Array<{ name: string; description?: string; meta?: any }>
  selectedName: string | null
  onSelect: (name: string, meta?: any) => void
}

export const AutomationList = React.memo<AutomationListProps>(({
  items,
  selectedName,
  onSelect,
}) => {
  return (
    <div className="h-full overflow-auto p-2">
      <div className="space-y-1">
        {items.map((it) => (
          <AutomationItem
            key={it.name}
            name={it.name}
            description={(it.meta as any)?.description}
            isSelected={selectedName === it.name}
            onSelect={() => onSelect(it.name, it.meta)}
            path={(it.meta as any)?.path}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-md border border-[var(--panel-border)] bg-[var(--panel)] p-3 text-sm text-muted-foreground">
            Nothing loaded yet.
          </div>
        )}
      </div>
    </div>
  )
})

AutomationList.displayName = "AutomationList"