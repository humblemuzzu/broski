import * as React from "react"
import { Wrench } from "lucide-react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"

export interface GenericToolCardProps {
  toolCall: ChatToolCall
}

export const GenericToolCard = React.memo(function GenericToolCard({
  toolCall,
}: GenericToolCardProps) {
  return (
    <BaseToolCard
      icon={Wrench}
      title={toolCall.tool}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!(toolCall.input || toolCall.output)}
      defaultExpanded={false}
    >
      <div className="space-y-2">
        {toolCall.input ? (
          <details>
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
            <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
              {typeof toolCall.output === "string"
                ? toolCall.output
                : JSON.stringify(toolCall.output, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </BaseToolCard>
  )
})