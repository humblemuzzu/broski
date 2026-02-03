import * as React from "react"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PresetItem } from "./PresetItem"

interface PresetManagerProps {
  presets: Array<{ id: string; name: string; url: string }>
  presetName: string
  onPresetNameChange: (name: string) => void
  onAdd: () => void
  onSelect: (url: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, direction: "up" | "down") => void
}

export const PresetManager = React.memo<PresetManagerProps>(({
  presets,
  presetName,
  onPresetNameChange,
  onAdd,
  onSelect,
  onRename,
  onRemove,
  onMove,
}) => {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Input
        value={presetName}
        onChange={(e) => onPresetNameChange(e.target.value)}
        placeholder="save as preset name"
        className="max-w-[220px]"
      />
      <Button size="sm" variant="outline" onClick={onAdd}>
        <Save className="mr-2 h-4 w-4" />
        Save Preset
      </Button>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.slice(0, 8).map((p, index) => (
            <PresetItem
              key={p.id}
              preset={p}
              onSelect={() => onSelect(p.url)}
              onRename={(name) => onRename(p.id, name)}
              onRemove={() => onRemove(p.id)}
              onMoveUp={() => onMove(p.id, "up")}
              onMoveDown={() => onMove(p.id, "down")}
              canMoveUp={index > 0}
              canMoveDown={index < presets.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
})

PresetManager.displayName = "PresetManager"