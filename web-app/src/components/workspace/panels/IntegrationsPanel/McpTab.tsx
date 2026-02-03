import * as React from "react"
import { Plug, Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { McpServerCard } from "./McpServerCard"
import { McpResourceCard } from "./McpResourceCard"

interface McpTabProps {
  mcpName: string
  onMcpNameChange: (name: string) => void
  servers: Array<{
    name: string
    status: string
    error?: string
    tools?: string[]
  }>
  resources: Array<{
    name: string
    uri: string
    client: string
    mimeType?: string
    description?: string
  }>
  codexMcpStatus: any
  onConnect: () => void
  onDisconnect: () => void
  onOpenResource: (uri: string) => void
  disabled: boolean
}

export const McpTab = React.memo<McpTabProps>(({
  mcpName,
  onMcpNameChange,
  servers,
  resources,
  codexMcpStatus,
  onConnect,
  onDisconnect,
  onOpenResource,
  disabled,
}) => {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
        <div className="text-xs font-semibold text-muted-foreground">OpenCode MCP</div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={mcpName}
            onChange={(e) => onMcpNameChange(e.target.value)}
            placeholder="server name"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={onConnect}
            disabled={disabled}
          >
            <Plug className="mr-2 h-4 w-4" />
            Connect
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDisconnect}
            disabled={disabled}
          >
            <Unplug className="mr-2 h-4 w-4" />
            Disconnect
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[11px] font-semibold text-muted-foreground">
              Servers ({servers.length})
            </div>
            <div className="mt-2 space-y-2">
              {servers.map((s) => (
                <McpServerCard key={s.name} server={s} />
              ))}
              {servers.length === 0 && (
                <div className="text-sm text-muted-foreground">No servers yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[11px] font-semibold text-muted-foreground">
              Resources ({resources.length})
            </div>
            <div className="mt-2 space-y-2">
              {resources.slice(0, 50).map((r) => (
                <McpResourceCard
                  key={r.uri}
                  resource={r}
                  onOpen={() => onOpenResource(r.uri)}
                />
              ))}
              {resources.length === 0 && (
                <div className="text-sm text-muted-foreground">No resources yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
        <div className="text-xs font-semibold text-muted-foreground">Codex MCP</div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          This reflects `cx_mcp_status_list` output (global).
        </div>
        <pre className="mt-2 max-h-[280px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {JSON.stringify(codexMcpStatus, null, 2)}
        </pre>
      </div>
    </div>
  )
})

McpTab.displayName = "McpTab"