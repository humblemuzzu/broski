import * as React from "react"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToolCard } from "./ToolCard"

interface ToolsTabProps {
  toolsProvider: string
  toolsModel: string
  onToolsProviderChange: (provider: string) => void
  onToolsModelChange: (model: string) => void
  toolIds: string[]
  tools: Array<{
    id: string
    description?: string
    parameters?: any
  }>
  providerOptions: Array<{
    id: string
    name: string
    models: string[]
  }>
  onListIds: () => void
  onListTools: () => void
  disabled: boolean
}

export const ToolsTab = React.memo<ToolsTabProps>(({
  toolsProvider,
  toolsModel,
  onToolsProviderChange,
  onToolsModelChange,
  toolIds,
  tools,
  providerOptions,
  onListIds,
  onListTools,
  disabled,
}) => {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
        <div className="text-xs font-semibold text-muted-foreground">OpenCode Tools</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onListIds} disabled={disabled}>
            IDs
          </Button>
          <div className="flex min-w-[260px] items-center gap-2">
            <Input 
              value={toolsProvider} 
              onChange={(e) => onToolsProviderChange(e.target.value)} 
              placeholder="provider id" 
            />
            <Input 
              value={toolsModel} 
              onChange={(e) => onToolsModelChange(e.target.value)} 
              placeholder="model id" 
            />
          </div>
          <Button
            size="sm"
            onClick={onListTools}
            disabled={disabled}
          >
            <Wrench className="mr-2 h-4 w-4" />
            List
          </Button>
        </div>

        {providerOptions.length > 0 && (
          <div className="mt-3 rounded-md border border-border bg-card p-3">
            <div className="text-[11px] font-semibold text-muted-foreground">
              Hint: providers/models from `list_all_providers`
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {providerOptions.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-md border border-border bg-[var(--panel)] p-2 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onToolsProviderChange(p.id)
                    onToolsModelChange(p.models[0] ?? "")
                  }}
                >
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{p.id}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Tool IDs ({toolIds.length})
          </summary>
          <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
            {JSON.stringify(toolIds, null, 2)}
          </pre>
        </details>

        <div className="mt-3 space-y-2">
          {tools.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
          {tools.length === 0 && (
            <div className="rounded-md border border-[var(--panel-border)] bg-[var(--panel)] p-3 text-sm text-muted-foreground">
              No tools loaded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

ToolsTab.displayName = "ToolsTab"