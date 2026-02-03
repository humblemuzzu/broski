import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { McpFileEditor } from "./McpFileEditor"

interface ClaudeCodeConfigProps {
  projectPath: string | null
  claudeModel: string
  onModelChange: (model: string) => void
  onSend: (message: any) => void
  config: any
  skills: any
  mcpFile: { path: string; content: string } | null
  mcpDraft: string
  onMcpDraftChange: (content: string) => void
}

export const ClaudeCodeConfig = React.memo<ClaudeCodeConfigProps>(function ClaudeCodeConfig({
  projectPath,
  claudeModel,
  onModelChange,
  onSend,
  config,
  skills,
  mcpFile,
  mcpDraft,
  onMcpDraftChange,
}) {
  const handleSetModel = () => {
    const m = claudeModel.trim()
    if (!m) return
    onSend({ 
      type: "cc_set_config", 
      cwd: projectPath ?? undefined, 
      config: { model: m } 
    })
  }

  const handleLoadMcp = () => {
    if (!projectPath) return
    onSend({ type: "cc_mcp_file_read", cwd: projectPath })
  }

  return (
    <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Claude Code
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "cc_get_config", cwd: projectPath ?? undefined })
          }
        >
          Config
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "cc_list_skills", cwd: projectPath ?? undefined })
          }
        >
          Skills
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleLoadMcp}
        >
          MCP
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={claudeModel}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="model (e.g. claude-sonnet)"
        />
        <Button size="sm" onClick={handleSetModel}>
          Set
        </Button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          Config payload
        </summary>
        <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          Skills payload
        </summary>
        <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {JSON.stringify(skills, null, 2)}
        </pre>
      </details>

      <McpFileEditor
        mcpFile={mcpFile}
        projectPath={projectPath}
        draft={mcpDraft}
        onDraftChange={onMcpDraftChange}
        onSend={onSend}
      />
    </div>
  )
})