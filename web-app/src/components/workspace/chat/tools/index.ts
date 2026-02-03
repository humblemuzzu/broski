import * as React from "react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"
import { ReadToolCard } from "./ReadToolCard"
import { EditToolCard } from "./EditToolCard"
import { WriteToolCard } from "./WriteToolCard"
import { BashToolCard } from "./BashToolCard"
import { WebSearchCard } from "./WebSearchCard"
import { SubagentCard } from "./SubagentCard"
import { GenericToolCard } from "./GenericToolCard"
import { GlobToolCard } from "./GlobToolCard"

export {
  BaseToolCard,
  ReadToolCard,
  EditToolCard,
  WriteToolCard,
  BashToolCard,
  WebSearchCard,
  SubagentCard,
  GenericToolCard,
  GlobToolCard,
}

export type ToolCardProps = {
  toolCall: ChatToolCall
}

export function getToolCard(toolName: string): React.ComponentType<ToolCardProps> {
  const lowerTool = toolName.toLowerCase()
  
  // Read operations
  if (lowerTool.includes("read")) {
    return ReadToolCard
  }
  
  // Glob operations (file pattern matching)
  if (lowerTool.includes("glob")) {
    return GlobToolCard
  }
  
  // Grep operations (content search)
  if (lowerTool.includes("grep")) {
    return ReadToolCard
  }
  
  // Edit operations (with diff support)
  if (lowerTool.includes("edit") || lowerTool.includes("patch") || lowerTool.includes("apply")) {
    return EditToolCard
  }
  
  // Write operations
  if (lowerTool.includes("write") || lowerTool.includes("create")) {
    return WriteToolCard
  }
  
  // Bash/shell operations
  if (lowerTool.includes("bash") || lowerTool.includes("shell") || lowerTool.includes("command")) {
    return BashToolCard
  }
  
  // Web search operations
  if (lowerTool.includes("websearch") || lowerTool.includes("web_search") || lowerTool.includes("search")) {
    return WebSearchCard
  }
  
  // Subagent/task operations
  if (lowerTool.includes("task") || lowerTool.includes("subagent") || lowerTool.includes("agent")) {
    return SubagentCard
  }
  
  // Fallback to generic card
  return GenericToolCard
}