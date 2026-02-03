import * as React from "react"
import { FileCode2 } from "lucide-react"

interface AutomationItemProps {
  name: string
  description?: string
  isSelected: boolean
  onSelect: () => void
  path?: string
}

export const AutomationItem = React.memo<AutomationItemProps>(({
  name,
  description,
  isSelected,
  onSelect,
  path,
}) => {
  return (
    <button
      className={[
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm",
        isSelected
          ? "bg-[var(--sidebar-item-active)]"
          : "hover:bg-[var(--sidebar-item-hover)]",
      ].join(" ")}
      onClick={onSelect}
      title={path ?? name}
    >
      <div className="min-w-0">
        <div className="truncate font-semibold">{name}</div>
        {description && (
          <div className="truncate text-[11px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
})

AutomationItem.displayName = "AutomationItem"