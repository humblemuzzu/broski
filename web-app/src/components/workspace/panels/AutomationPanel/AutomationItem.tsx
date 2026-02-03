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
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm"
      style={{ 
        backgroundColor: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
      }}
      onClick={onSelect}
      title={path ?? name}
    >
      <div className="min-w-0">
        <div className="truncate font-semibold" style={{ color: '#e8e8e8' }}>{name}</div>
        {description && (
          <div className="truncate text-[11px]" style={{ color: '#808080' }}>
            {description}
          </div>
        )}
      </div>
      <FileCode2 className="h-4 w-4 shrink-0" style={{ color: '#808080' }} />
    </button>
  )
})

AutomationItem.displayName = "AutomationItem"