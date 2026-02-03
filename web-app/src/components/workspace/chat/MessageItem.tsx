import * as React from "react"
import { ToolCallCard } from "./ToolCallCard"
import { ThinkingBlock } from "./ThinkingBlock"

export interface MessageItemProps {
  message: {
    id: string
    role: string
    text: string
    thinking?: string
    toolCalls?: any[]
  }
  style: React.CSSProperties
}

export const MessageItem = React.memo(function MessageItem({
  message,
  style,
}: MessageItemProps) {
  return (
    <div style={style}>
      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
        <div className="text-xs font-semibold text-muted-foreground">
          {message.role.toUpperCase()}
        </div>
        <div className="mt-1 whitespace-pre-wrap text-sm">
          {message.text}
        </div>
        {message.thinking ? (
          <ThinkingBlock content={message.thinking} />
        ) : null}
        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div className="mt-2 space-y-2">
            {message.toolCalls.map((toolCall) => (
              <ToolCallCard key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
})