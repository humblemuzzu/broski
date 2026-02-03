import * as React from "react"
import { Bot } from "lucide-react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"

export interface SubagentCardProps {
  toolCall: ChatToolCall
}

export const SubagentCard = React.memo(function SubagentCard({
  toolCall,
}: SubagentCardProps) {
  const subagentInfo = React.useMemo(() => {
    if (!toolCall.input || typeof toolCall.input !== "object") return null
    const input = toolCall.input as Record<string, unknown>
    
    const prompt = (
      (input.prompt as string | undefined) ??
      (input.task as string | undefined) ??
      (input.message as string | undefined) ??
      null
    )
    
    const type = (
      (input.type as string | undefined) ??
      (input.agent as string | undefined) ??
      (input.subagent as string | undefined) ??
      "Task"
    )
    
    return { type, prompt }
  }, [toolCall.input])

  const promptPreview = React.useMemo(() => {
    if (!subagentInfo?.prompt) return null
    if (subagentInfo.prompt.length <= 100) return subagentInfo.prompt
    return subagentInfo.prompt.slice(0, 100) + "..."
  }, [subagentInfo])

  return (
    <BaseToolCard
      icon={Bot}
      title={subagentInfo?.type || toolCall.tool}
      subtitle={promptPreview || undefined}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!(subagentInfo?.prompt || toolCall.output)}
      defaultExpanded={false}
    >
      {subagentInfo?.prompt || toolCall.output ? (
        <div className="space-y-2">
          {subagentInfo?.prompt ? (
            <details>
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                Prompt
              </summary>
              <div className="mt-2 max-h-[180px] overflow-auto rounded-md bg-black/20 p-2 text-[11px] whitespace-pre-wrap">
                {subagentInfo.prompt}
              </div>
            </details>
          ) : null}
          {toolCall.output ? (
            <details>
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
      ) : null}
    </BaseToolCard>
  )
})