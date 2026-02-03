import * as React from "react"
import { TerminalSquare } from "lucide-react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"

export interface BashToolCardProps {
  toolCall: ChatToolCall
}

export const BashToolCard = React.memo(function BashToolCard({
  toolCall,
}: BashToolCardProps) {
  const command = React.useMemo(() => {
    if (!toolCall.input || typeof toolCall.input !== "object") return null
    const input = toolCall.input as Record<string, unknown>
    return (
      (input.command as string | undefined) ??
      (input.cmd as string | undefined) ??
      null
    )
  }, [toolCall.input])

  return (
    <BaseToolCard
      icon={TerminalSquare}
      title={toolCall.tool}
      subtitle={command || undefined}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!toolCall.output}
      defaultExpanded={true}
    >
      {toolCall.output ? (
        <div>
          <div className="mb-2 text-[11px] text-muted-foreground">
            Output
          </div>
          <pre className="max-h-[220px] overflow-auto rounded-md bg-black/10 p-2 font-mono text-[11px] text-foreground">
            {typeof toolCall.output === "string"
              ? toolCall.output
              : JSON.stringify(toolCall.output, null, 2)}
          </pre>
        </div>
      ) : null}
    </BaseToolCard>
  )
})