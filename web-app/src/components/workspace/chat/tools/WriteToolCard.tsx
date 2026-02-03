import * as React from "react"
import { Code } from "lucide-react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"

export interface WriteToolCardProps {
  toolCall: ChatToolCall
}

export const WriteToolCard = React.memo(function WriteToolCard({
  toolCall,
}: WriteToolCardProps) {
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

  const content = React.useMemo(() => {
    if (!toolCall.input || typeof toolCall.input !== "object") return null
    const input = toolCall.input as Record<string, unknown>
    return input.content as string | undefined
  }, [toolCall.input])

  const contentPreview = React.useMemo(() => {
    if (!content) return null
    if (content.length <= 200) return content
    return content.slice(0, 200) + "..."
  }, [content])

  return (
    <BaseToolCard
      icon={Code}
      title={toolCall.tool}
      subtitle={filePath || undefined}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!content}
      defaultExpanded={false}
    >
      {content ? (
        <div>
          <div className="mb-2 text-[11px] text-muted-foreground">
            {content.split("\n").length} lines, {content.length} chars
          </div>
          <details>
            <summary className="cursor-pointer text-[11px] text-muted-foreground mb-2">
              Content Preview
            </summary>
            <pre className="max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
              {contentPreview}
            </pre>
          </details>
          {toolCall.output ? (
            <details>
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                Output
              </summary>
              <pre className="mt-2 max-h-[180px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                {typeof toolCall.output === "string"
                  ? toolCall.output
                  : JSON.stringify(toolCall.output, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </BaseToolCard>
  )
})