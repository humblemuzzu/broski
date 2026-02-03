import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface CodexConfigProps {
  projectPath: string | null
  codexModel: string
  onModelChange: (model: string) => void
  onSend: (message: any) => void
  models: any
  config: any
  skills: any
  mcpStatus: any
}

export const CodexConfig = React.memo<CodexConfigProps>(function CodexConfig({
  projectPath,
  codexModel,
  onModelChange,
  onSend,
  models,
  config,
  skills,
  mcpStatus,
}) {
  const handleStartThread = () => {
    const m = codexModel.trim()
    if (!m || !projectPath) return
    // Start a thread with an explicit model (Codex creates threads on chat, but
    // `cx_start_thread` gives explicit control).
    onSend({ 
      type: "cx_start_thread", 
      cwd: projectPath, 
      model: m 
    })
  }

  return (
    <div 
      className="rounded-lg p-3"
      style={{ 
        backgroundColor: '#171717', 
        border: '1px solid rgba(255,255,255,0.06)' 
      }}
    >
      <div className="text-xs font-semibold" style={{ color: '#e8e8e8' }}>
        Codex
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "cx_model_list" })}
        >
          Models
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "cx_config_read" })}
        >
          Config
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "cx_skills_list", cwd: projectPath ?? undefined })
          }
        >
          Skills
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "cx_mcp_status_list" })}
        >
          MCP Status
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "cx_mcp_reload" })}
        >
          Reload MCP
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={codexModel}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="model (e.g. gpt-4.1)"
          style={{ color: '#e8e8e8', backgroundColor: '#0f0f0f', border: '1px solid rgba(255,255,255,0.1)' }}
        />
        <Button size="sm" onClick={handleStartThread}>
          Start
        </Button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px]" style={{ color: '#808080' }}>
          Models payload
        </summary>
        <pre 
          className="mt-2 max-h-[220px] overflow-auto rounded-md p-2 text-[11px]"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', color: '#a8a8a8' }}
        >
          {JSON.stringify(models, null, 2)}
        </pre>
      </details>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px]" style={{ color: '#808080' }}>
          Config payload
        </summary>
        <pre 
          className="mt-2 max-h-[220px] overflow-auto rounded-md p-2 text-[11px]"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', color: '#a8a8a8' }}
        >
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px]" style={{ color: '#808080' }}>
          Skills payload
        </summary>
        <pre 
          className="mt-2 max-h-[220px] overflow-auto rounded-md p-2 text-[11px]"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', color: '#a8a8a8' }}
        >
          {JSON.stringify(skills, null, 2)}
        </pre>
      </details>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px]" style={{ color: '#808080' }}>
          MCP status payload
        </summary>
        <pre 
          className="mt-2 max-h-[220px] overflow-auto rounded-md p-2 text-[11px]"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', color: '#a8a8a8' }}
        >
          {JSON.stringify(mcpStatus, null, 2)}
        </pre>
      </details>
    </div>
  )
})