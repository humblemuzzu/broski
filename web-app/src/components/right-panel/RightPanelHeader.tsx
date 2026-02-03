import * as React from "react"
import { Button } from "@/components/ui/button"

interface RightPanelHeaderProps {
  mode: "activity" | "config"
  onModeChange: (mode: "activity" | "config") => void
  onClear: () => void
  onHide: () => void
}

export const RightPanelHeader = React.memo<RightPanelHeaderProps>(function RightPanelHeader({
  mode,
  onModeChange,
  onClear,
  onHide,
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div className="text-sm font-semibold">
        {mode === "config" ? "Config" : "Activity"}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant={mode === "activity" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onModeChange("activity")}
        >
          Activity
        </Button>
        <Button
          variant={mode === "config" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onModeChange("config")}
        >
          Config
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <Button variant="ghost" size="sm" onClick={onHide}>
          Hide
        </Button>
      </div>
    </div>
  )
})