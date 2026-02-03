import * as React from "react"

interface McpServerCardProps {
  server: { 
    name: string
    status: string
    error?: string
    tools?: string[]
  }
}

export const McpServerCard = React.memo<McpServerCardProps>(({ server }) => {
  return (
    <div className="rounded-md border border-border bg-[var(--panel)] p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{server.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {server.status}
            {server.error ? ` · ${server.error}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {(server.tools?.length ?? 0)} tools
        </div>
      </div>
      {Array.isArray(server.tools) && server.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {server.tools.slice(0, 12).map((t) => (
            <span
              key={t}
              className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})

McpServerCard.displayName = "McpServerCard"