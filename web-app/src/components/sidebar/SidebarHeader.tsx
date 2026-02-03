import { PanelLeftClose, PanelLeft } from "lucide-react"

interface SidebarHeaderProps {
  collapsed: boolean
  wsState: "idle" | "connecting" | "open" | "error" | "closed"
  onToggle: () => void
}

export function SidebarHeader({ collapsed, wsState, onToggle }: SidebarHeaderProps) {
  const isConnected = wsState === "open"
  
  return (
    <div className="flex items-center justify-between px-3 py-4">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Logo mark */}
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] 
                        flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">B</span>
        </div>
        
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--text)] truncate">
              Broski
            </div>
            <div className="flex items-center gap-1.5">
              <span 
                className={[
                  "status-dot",
                  isConnected ? "running" : "idle"
                ].join(" ")}
              />
              <span className="text-[11px] text-[var(--text-muted)]">
                {isConnected ? "Connected" : wsState}
              </span>
            </div>
          </div>
        )}
      </div>
      
      <button
        onClick={onToggle}
        className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] 
                   hover:bg-[var(--bg-hover)] transition-all"
        aria-label="Toggle sidebar"
      >
        {collapsed ? (
          <PanelLeft className="h-4 w-4" />
        ) : (
          <PanelLeftClose className="h-4 w-4" />
        )}
      </button>
    </div>
  )
}
