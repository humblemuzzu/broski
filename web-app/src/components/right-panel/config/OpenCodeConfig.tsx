import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface OpenCodeConfigProps {
  projectPath: string | null
  openCodeModel: string
  onModelChange: (model: string) => void
  onSend: (message: any) => void
  providers: any
  config: any
}

export const OpenCodeConfig = React.memo<OpenCodeConfigProps>(function OpenCodeConfig({
  projectPath,
  openCodeModel,
  onModelChange,
  onSend,
  providers,
  config,
}) {
  const handleSetModel = () => {
    const m = openCodeModel.trim()
    if (!m) return
    onSend({ 
      type: "set_model", 
      model: m, 
      projectPath: projectPath ?? undefined 
    })
  }

  return (
    <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        OpenCode
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "list_providers" })}
        >
          Providers
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "get_config", projectPath: projectPath ?? undefined })
          }
        >
          Config
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "list_commands", projectPath: projectPath ?? undefined })
          }
        >
          Commands
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "list_agents", projectPath: projectPath ?? undefined })
          }
        >
          Agents
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={openCodeModel}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="model (providerID:modelID)"
        />
        <Button size="sm" onClick={handleSetModel}>
          Set
        </Button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          Providers payload
        </summary>
        <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {JSON.stringify(providers, null, 2)}
        </pre>
      </details>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          Config payload
        </summary>
        <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>
    </div>
  )
})