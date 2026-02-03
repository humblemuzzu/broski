import * as React from "react"
import { Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type KindTab = "skills" | "commands" | "agents" | "plugins" | "hooks"
type BackendTab = "opencode" | "claude-code" | "codex"

interface AutomationControlsProps {
  newName: string
  onNewNameChange: (name: string) => void
  onSave: () => void
  onDelete: () => void
  selectedName: string | null
  kind: KindTab
  backend: BackendTab
  disabled: boolean
}

export const AutomationControls = React.memo<AutomationControlsProps>(({
  newName,
  onNewNameChange,
  onSave,
  onDelete,
  selectedName,
  kind,
  backend,
  disabled,
}) => {
  const placeholder = kind === "hooks"
    ? "hooks.json"
    : backend === "codex"
      ? "name (Repo/User)"
      : "new file name"

  return (
    <div 
      className="flex items-center gap-2 p-3"
      style={{ 
        backgroundColor: '#0f0f0f', 
        borderBottom: '1px solid rgba(255,255,255,0.06)' 
      }}
    >
      <Input
        value={newName}
        onChange={(e) => onNewNameChange(e.target.value)}
        placeholder={placeholder}
        disabled={kind === "hooks"}
      />
      <Button
        size="icon"
        variant="outline"
        aria-label="Save"
        onClick={onSave}
        disabled={disabled}
      >
        <Save className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="outline"
        aria-label="Delete"
        onClick={onDelete}
        disabled={!selectedName || kind === "hooks"}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
})

AutomationControls.displayName = "AutomationControls"