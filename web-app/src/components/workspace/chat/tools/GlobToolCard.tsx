import * as React from "react"
import { Search } from "lucide-react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"

export interface GlobToolCardProps {
  toolCall: ChatToolCall
}

export const GlobToolCard = React.memo(function GlobToolCard({
  toolCall,
}: GlobToolCardProps) {
  const pattern = React.useMemo(() => {
    if (!toolCall.input || typeof toolCall.input !== "object") return null
    const input = toolCall.input as Record<string, unknown>
    return (
      (input.pattern as string | undefined) ??
      (input.glob as string | undefined) ??
      null
    )
  }, [toolCall.input])

  const resultCount = React.useMemo(() => {
    if (typeof toolCall.output === "string") {
      const lines = toolCall.output.split("\n").filter(line => line.trim()).length
      return `${lines} files found`
    }
    return null
  }, [toolCall.output])

  return (
    <BaseToolCard
      icon={Search}
      title={toolCall.tool}
      subtitle={pattern || undefined}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!toolCall.output}
      defaultExpanded={true}
    >
      {toolCall.output ? (
        <div>
          {resultCount ? (
            <div className="mb-2 text-[11px] text-muted-foreground">
              {resultCount}
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