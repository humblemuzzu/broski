import * as React from "react"
import { Wrench } from "lucide-react"

interface ToolCardProps {
  tool: {
    id: string
    description?: string
    parameters?: any
  }
}

export const ToolCard = React.memo<ToolCardProps>(({ tool }) => {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{tool.id}</div>
          {tool.description && (
            <div className="truncate text-[11px] text-muted-foreground">
              {tool.description}
            </div>
          )}
        </div>
      </div>
      {tool.parameters && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Parameters
          </summary>
          <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
            {JSON.stringify(tool.parameters, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
})

ToolCard.displayName = "ToolCard"