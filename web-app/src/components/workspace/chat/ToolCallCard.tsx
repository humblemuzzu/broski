import { Code, FileText, Pencil, TerminalSquare, Wrench } from "lucide-react"
import { diffLines } from "diff"

import type { ChatToolCall } from "@/stores/chat-store"
import { DiffBlock } from "@/components/workspace/chat/DiffBlock"

function iconForTool(tool: string) {
  const t = tool.toLowerCase()
  if (t.includes("bash") || t.includes("shell") || t.includes("command"))
    return TerminalSquare
  if (t.includes("read")) return FileText
  if (t.includes("edit")) return Pencil
  if (t.includes("write")) return Code
  return Wrench
}

function summarizeInput(tool: string, input: unknown) {
  if (!input || typeof input !== "object") return null
  const anyInput = input as Record<string, unknown>
  const t = tool.toLowerCase()
  if (t.includes("bash")) {
    return (
      (anyInput.command as string | undefined) ??
      (anyInput.cmd as string | undefined) ??
      null
    )
  }
  if (t.includes("read")) {
    return (
      (anyInput.file_path as string | undefined) ??
      (anyInput.path as string | undefined) ??
      null
    )
  }
  if (t.includes("write") || t.includes("edit")) {
    return (
      (anyInput.path as string | undefined) ??
      (anyInput.file_path as string | undefined) ??
      null
    )
  }
  return null
}

export function ToolCallCard({ toolCall }: { toolCall: ChatToolCall }) {
  const Icon = iconForTool(toolCall.tool)
  const summary = summarizeInput(toolCall.tool, toolCall.input)
  const lowerTool = toolCall.tool.toLowerCase()

  const diffText = (() => {
    if (!toolCall.output || typeof toolCall.output !== "object") return null
    const out = toolCall.output as Record<string, unknown>
    if (typeof out.diff === "string") return out.diff
    const before = out.before
    const after = out.after
    if (typeof before === "string" && typeof after === "string") {
      const parts = diffLines(before, after)
      const lines: string[] = []
      for (const p of parts) {
        const prefix = p.added ? "+" : p.removed ? "-" : " "
        for (const l of p.value.split("\n")) {
          if (l.length === 0) continue
          lines.push(prefix + l)
        }
      }
      return lines.join("\n")
    }
    return null
  })()

  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">
              {toolCall.tool}
            </div>
            {summary ? (
              <div className="truncate text-[11px] text-muted-foreground">
                {summary}
              </div>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {toolCall.status}
        </div>
      </div>

      {toolCall.input ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Input
          </summary>
          <pre className="mt-2 max-h-[180px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
        </details>
      ) : null}

      {toolCall.output ? (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Output
          </summary>
          {diffText &&
          (lowerTool.includes("edit") ||
            lowerTool.includes("diff") ||
            lowerTool.includes("patch") ||
            lowerTool.includes("apply")) ? (
            <DiffBlock diff={diffText} />
          ) : (
            <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
              {typeof toolCall.output === "string"
                ? toolCall.output
                : JSON.stringify(toolCall.output, null, 2)}
            </pre>
          )}
        </details>
      ) : null}
    </div>
  )
}
