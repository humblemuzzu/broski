import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

export interface BaseToolCardProps {
  icon: React.ElementType
  title: string
  subtitle?: string
  status: "running" | "done" | "error"
  expandable?: boolean
  defaultExpanded?: boolean
  children?: React.ReactNode
}

export const BaseToolCard = React.memo(function BaseToolCard({
  icon: Icon,
  title,
  subtitle,
  status,
  expandable = false,
  defaultExpanded = true,
  children,
}: BaseToolCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)

  const statusColor = React.useMemo(() => {
    switch (status) {
      case "running":
        return "text-blue-400"
      case "done":
        return "text-green-400"
      case "error":
        return "text-red-400"
      default:
        return "text-muted-foreground"
    }
  }, [status])

  const handleToggle = React.useCallback(() => {
    if (expandable) {
      setIsExpanded((prev) => !prev)
    }
  }, [expandable])

  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div 
        className={`flex items-center justify-between gap-2 ${
          expandable ? "cursor-pointer" : ""
        }`}
        onClick={handleToggle}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">
              {title}
            </div>
            {subtitle ? (
              <div className="truncate text-[11px] text-muted-foreground">
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className={`text-[11px] ${statusColor}`}>
            {status}
          </div>
          {expandable && children ? (
            isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          ) : null}
        </div>
      </div>

      {children && (!expandable || isExpanded) ? (
        <div className="mt-2">
          {children}
        </div>
      ) : null}
    </div>
  )
})