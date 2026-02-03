import * as React from "react"

interface CommandPaletteItemProps {
  icon?: React.ElementType
  label: string
  shortcut?: string
  hint?: string
  disabled?: boolean
  onSelect: () => void
}

export const CommandPaletteItem = React.memo<CommandPaletteItemProps>(({
  icon: Icon,
  label,
  shortcut,
  hint,
  disabled = false,
  onSelect,
}) => {
  return (
    <button
      className="w-full rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      type="button"
      disabled={disabled}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <div className="truncate">{label}</div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {hint && (
            <div className="truncate text-[11px] text-muted-foreground">
              {hint}
            </div>
          )}
          {shortcut && (
            <div className="text-[11px] text-muted-foreground">
              {shortcut}
            </div>
          )}
        </div>
      </div>
    </button>
  )
})

CommandPaletteItem.displayName = "CommandPaletteItem"