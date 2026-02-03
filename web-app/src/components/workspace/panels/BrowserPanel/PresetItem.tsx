import * as React from "react"
import { Check, ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react"

interface PresetItemProps {
  preset: { id: string; name: string; url: string }
  onSelect: () => void
  onRename: (name: string) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}

export const PresetItem = React.memo<PresetItemProps>(({
  preset,
  onSelect,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) => {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editName, setEditName] = React.useState(preset.name)

  const handleSaveRename = () => {
    onRename(editName)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveRename()
    }
    if (e.key === "Escape") {
      setIsEditing(false)
      setEditName(preset.name)
    }
  }

  return (
    <div className="flex items-center overflow-hidden rounded-md border border-border bg-card">
      {isEditing ? (
        <>
          <input
            className="h-8 w-[140px] bg-transparent px-2 text-sm outline-none"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            className="border-l border-border px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={handleSaveRename}
            type="button"
            aria-label="Save preset name"
          >
            <Check className="h-4 w-4 text-muted-foreground" />
          </button>
        </>
      ) : (
        <>
          <button
            className="px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={onSelect}
            title={preset.url}
            type="button"
          >
            {preset.name}
          </button>
          <button
            className="border-l border-border px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setIsEditing(true)
              setEditName(preset.name)
            }}
            type="button"
            aria-label="Rename preset"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </button>
        </>
      )}
      <button
        className="border-l border-border px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        onClick={onMoveUp}
        type="button"
        aria-label="Move preset up"
        disabled={!canMoveUp}
      >
        <ChevronUp className="h-4 w-4 text-muted-foreground" />
      </button>
      <button
        className="border-l border-border px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        onClick={onMoveDown}
        type="button"
        aria-label="Move preset down"
        disabled={!canMoveDown}
      >
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
      <button
        className="border-l border-border px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={onRemove}
        type="button"
        aria-label="Remove preset"
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  )
})

PresetItem.displayName = "PresetItem"