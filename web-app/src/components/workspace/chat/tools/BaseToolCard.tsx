import * as React from "react"
import { ChevronDown, ChevronRight, Loader2, Check, X } from "lucide-react"

export interface BaseToolCardProps {
  icon: React.ElementType
  title: string
  subtitle?: string
  status: "running" | "done" | "error"
  color?: string
  bgColor?: string
  expandable?: boolean
  defaultExpanded?: boolean
  children?: React.ReactNode
}

export const BaseToolCard = React.memo(function BaseToolCard({
  icon: Icon,
  title,
  subtitle,
  status,
  color = "var(--text-muted)",
  bgColor = "var(--bg-elevated)",
  expandable = false,
  defaultExpanded = true,
  children,
}: BaseToolCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)

  const handleToggle = React.useCallback(() => {
    if (expandable) {
      setIsExpanded((prev) => !prev)
    }
  }, [expandable])

  // Status indicator
  const StatusIndicator = React.useMemo(() => {
    switch (status) {
      case "running":
        return <Loader2 className="h-3 w-3 animate-spin text-[var(--accent)]" />
      case "done":
        return <Check className="h-3 w-3 text-[var(--success)]" />
      case "error":
        return <X className="h-3 w-3 text-[var(--error)]" />
      default:
        return null
    }
  }, [status])

  return (
    <div 
      className="rounded-xl border border-[var(--border-subtle)] overflow-hidden"
      style={{ backgroundColor: bgColor }}
    >
      {/* Header */}
      <div 
        className={[
          "flex items-center justify-between gap-3 px-3 py-2.5",
          expandable ? "cursor-pointer hover:bg-[var(--bg-hover)]" : ""
        ].join(" ")}
        onClick={handleToggle}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div 
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-[var(--text)]">
              {title}
            </div>
            {subtitle && (
              <div className="truncate text-[10px] text-[var(--text-muted)] mt-0.5">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex shrink-0 items-center gap-2">
          {StatusIndicator}
          {expandable && children && (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-faint)]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[var(--text-faint)]" />
            )
          )}
        </div>
      </div>

      {/* Content */}
      {children && (!expandable || isExpanded) && (
        <div className="px-3 pb-3 pt-1">
          {children}
        </div>
      )}
    </div>
  )
})
