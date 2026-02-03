import * as React from "react"
import { Button } from "@/components/ui/button"

interface McpResourceCardProps {
  resource: {
    name: string
    uri: string
    client: string
    mimeType?: string
    description?: string
  }
  onOpen: () => void
}

export const McpResourceCard = React.memo<McpResourceCardProps>(({ resource, onOpen }) => {
  const canOpen = resource.uri?.startsWith("file://") || resource.uri?.startsWith("/")

  return (
    <div className="rounded-md border border-border bg-[var(--panel)] p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{resource.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{resource.uri}</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpen}
          disabled={!canOpen}
        >
          Open
        </Button>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {resource.client}
        {resource.mimeType ? ` · ${resource.mimeType}` : ""}
      </div>
      {resource.description && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {resource.description}
        </div>
      )}
    </div>
  )
})

McpResourceCard.displayName = "McpResourceCard"