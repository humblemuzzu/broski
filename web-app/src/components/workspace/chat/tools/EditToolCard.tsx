import * as React from "react"
import { Pencil } from "lucide-react"
import { diffLines } from "diff"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"
import { DiffBlock } from "../DiffBlock"

export interface EditToolCardProps {
  toolCall: ChatToolCall
}

export const EditToolCard = React.memo(function EditToolCard({
  toolCall,
}: EditToolCardProps) {
  const filePath = React.useMemo(() => {
    if (!toolCall.input || typeof toolCall.input !== "object") return null
    const input = toolCall.input as Record<string, unknown>
    return (
      (input.path as string | undefined) ??
      (input.filePath as string | undefined) ??
      (input.file_path as string | undefined) ??
      null
    )
  }, [toolCall.input])

  const diffText = React.useMemo(() => {
    if (!toolCall.output || typeof toolCall.output !== "object") return null
    const output = toolCall.output as Record<string, unknown>
    
    // Check for explicit diff field
    if (typeof output.diff === "string") return output.diff
    
    // Generate diff from before/after
    const before = output.before
    const after = output.after
    if (typeof before === "string" && typeof after === "string") {
      const parts = diffLines(before, after)
      const lines: string[] = []
      for (const part of parts) {
        const prefix = part.added ? "+" : part.removed ? "-" : " "
        for (const line of part.value.split("\n")) {
          if (line.length === 0) continue
          lines.push(prefix + line)
        }
      }
      return lines.join("\n")
    }
    
    return null
  }, [toolCall.output])

  return (
    <BaseToolCard
      icon={Pencil}
      title={toolCall.tool}
      subtitle={filePath || undefined}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!diffText}
      defaultExpanded={true}
    >
      {diffText ? (
        <DiffBlock diff={diffText} />
      ) : toolCall.output ? (
        <pre className="max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {typeof toolCall.output === "string"
            ? toolCall.output
            : JSON.stringify(toolCall.output, null, 2)}
        </pre>
      ) : null}
    </BaseToolCard>
  )
})