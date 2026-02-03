import * as React from "react"
import { Activity, Settings, Trash2, PanelRightClose } from "lucide-react"

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
    <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{ 
            backgroundColor: mode === "activity" ? '#171717' : 'transparent',
            color: mode === "activity" ? '#e8e8e8' : '#808080',
            boxShadow: mode === "activity" ? '0 1px 2px rgba(0,0,0,0.3)' : 'none'
          }}
          onClick={() => onModeChange("activity")}
        >
          <Activity className="h-3 w-3" />
          Activity
        </button>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{ 
            backgroundColor: mode === "config" ? '#171717' : 'transparent',
            color: mode === "config" ? '#e8e8e8' : '#808080',
            boxShadow: mode === "config" ? '0 1px 2px rgba(0,0,0,0.3)' : 'none'
          }}
          onClick={() => onModeChange("config")}
        >
          <Settings className="h-3 w-3" />
          Config
        </button>
      </div>
      
      {/* Actions */}
      <div className="flex items-center gap-1">
        <button 
          className="p-1.5 rounded-md transition-all hover:bg-[rgba(255,255,255,0.06)]"
          style={{ color: '#5c5c5c' }}
          onClick={onClear}
          title="Clear"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button 
          className="p-1.5 rounded-md transition-all hover:bg-[rgba(255,255,255,0.06)]"
          style={{ color: '#5c5c5c' }}
          onClick={onHide}
          title="Hide panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
})
