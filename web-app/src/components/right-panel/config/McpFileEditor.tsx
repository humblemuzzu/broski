import * as React from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface McpFileEditorProps {
  mcpFile: { path: string; content: string } | null
  projectPath: string | null
  draft: string
  onDraftChange: (content: string) => void
  onSend: (message: any) => void
}

export const McpFileEditor = React.memo<McpFileEditorProps>(function McpFileEditor({
  mcpFile,
  projectPath,
  draft,
  onDraftChange,
  onSend,
}) {
  const handleSaveMcp = () => {
    if (!projectPath) return
    onSend({ 
      type: "cc_mcp_file_write", 
      cwd: projectPath, 
      content: draft 
    })
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] text-muted-foreground">
        MCP file
      </summary>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {mcpFile?.path ? `path: ${mcpFile.path}` : "Load with MCP button"}
      </div>
      <div className="mt-2">
        <Textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="mcp.json content"
          className="min-h-[160px] font-mono text-[11px]"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleSaveMcp}
          disabled={!projectPath}
        >
          Save MCP
        </Button>
      </div>
    </details>
  )
})