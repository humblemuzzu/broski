import * as React from "react"
import { FileText } from "lucide-react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"

export interface ReadToolCardProps {
  toolCall: ChatToolCall
}

export const ReadToolCard = React.memo(function ReadToolCard({
  toolCall,
}: ReadToolCardProps) {
  const filePath = React.useMemo(() => {
    if (!toolCall.input || typeof toolCall.input !== "object") return null
    const input = toolCall.input as Record<string, unknown>
    return (
      (input.filePath as string | undefined) ??
      (input.file_path as string | undefined) ??
      (input.path as string | undefined) ??
      null
    )
  }, [toolCall.input])

  const lineInfo = React.useMemo(() => {
    if (typeof toolCall.output === "string") {
      const lines = toolCall.output.split("\n").length
      return `${lines} lines`
    }
    return null
  }, [toolCall.output])

  return (
    <BaseToolCard
      icon={FileText}
      title={toolCall.tool}
      subtitle={filePath || undefined}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!toolCall.output}
      defaultExpanded={true}
    >
      {toolCall.output ? (
        <div>
          {lineInfo ? (
            <div className="mb-2 text-[11px] text-muted-foreground">
              {lineInfo}
            </div>
          ) : null}
          <pre className="max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
            {typeof toolCall.output === "string"
              ? toolCall.output
              : JSON.stringify(toolCall.output, null, 2)}
          </pre>
        </div>
      ) : null}
    </BaseToolCard>
  )
})