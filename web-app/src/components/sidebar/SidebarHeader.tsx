import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"

interface SidebarHeaderProps {
  collapsed: boolean;
  wsState: "idle" | "connecting" | "open" | "error" | "closed";
  onToggle: () => void;
}

export function SidebarHeader({ collapsed, wsState, onToggle }: SidebarHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--sidebar-border)] px-3 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">Broski</div>
        {!collapsed ? (
          <div className="text-xs text-muted-foreground">
            {wsState === "open" ? "Connected" : wsState}
          </div>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="shrink-0"
        aria-label="Toggle sidebar"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}