import * as React from "react"
import { Button } from "@/components/ui/button"
import { TodoList } from "./TodoList"
import { SlashCommandList } from "./SlashCommandList"
import { AgentsList } from "./AgentsList"

interface OpenCodeToolsProps {
  sessionId: string
  todos: Array<{ id: string; content: string; status: string; priority: string }>
  commands: Array<{ name: string; description?: string }>
  agents: Array<{ name: string }>
  commandToRun: string
  commandArgs: string
  onCommandToRunChange: (command: string) => void
  onCommandArgsChange: (args: string) => void
  onSend: (message: any) => void
}

export const OpenCodeTools = React.memo<OpenCodeToolsProps>(function OpenCodeTools({
  sessionId,
  todos,
  commands,
  agents,
  commandToRun,
  commandArgs,
  onCommandToRunChange,
  onCommandArgsChange,
  onSend,
}) {
  return (
    <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        OpenCode · Session Tools
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "get_todos", sessionId: sessionId })
          }
        >
          Todos
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "list_commands" })}
        >
          Commands
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "list_agents" })}
        >
          Agents
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSend({ type: "get_lsp_status" })}
        >
          LSP
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSend({ type: "get_session_context", sessionId: sessionId })
          }
        >
          Context
        </Button>
      </div>

      <TodoList todos={todos} />
      
      <SlashCommandList
        commands={commands}
        sessionId={sessionId}
        commandToRun={commandToRun}
        commandArgs={commandArgs}
        onCommandToRunChange={onCommandToRunChange}
        onCommandArgsChange={onCommandArgsChange}
        onSend={onSend}
      />

      <AgentsList agents={agents} />
    </div>
  )
})