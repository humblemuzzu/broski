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
  const isUser = message.role === "user"
  
  return (
    <div style={style}>
      <div className="py-2">
        {/* User message - simple right-aligned */}
        {isUser ? (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-[var(--bg-contrast)] text-[var(--text)]">
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {message.text}
              </div>
            </div>
          </div>
        ) : (
          /* Assistant message - clean left-aligned */
          <div className="space-y-3">
            {/* Thinking block */}
            {message.thinking && (
              <ThinkingBlock content={message.thinking} />
            )}
            
            {/* Tool calls */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="space-y-2">
                {message.toolCalls.map((toolCall) => (
                  <ToolCallCard key={toolCall.id} toolCall={toolCall} />
                ))}
              </div>
            )}
            
            {/* Text content */}
            {message.text && (
              <div className="text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                {message.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
