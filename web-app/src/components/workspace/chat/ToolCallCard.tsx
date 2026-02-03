import type { ChatToolCall } from "@/stores/chat-store"
import { getToolCard } from "./tools"

export function ToolCallCard({ toolCall }: { toolCall: ChatToolCall }) {
  const ToolComponent = getToolCard(toolCall.tool)
  return <ToolComponent toolCall={toolCall} />
}
