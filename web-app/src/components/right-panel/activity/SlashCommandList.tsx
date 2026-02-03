import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Command {
  name: string
  description?: string
}

interface SlashCommandListProps {
  commands: Command[]
  sessionId: string
  commandToRun: string
  commandArgs: string
  onCommandToRunChange: (command: string) => void
  onCommandArgsChange: (args: string) => void
  onSend: (message: any) => void
}

export const SlashCommandList = React.memo<SlashCommandListProps>(function SlashCommandList({
  commands,
  sessionId,
  commandToRun,
  commandArgs,
  onCommandToRunChange,
  onCommandArgsChange,
  onSend,
}) {
  if (!commands || commands.length === 0) {
    return null
  }

  const handleRunCommand = () => {
    if (!commandToRun.trim()) return
    onSend({
      type: "execute_command",
      sessionId: sessionId,
      command: commandToRun.trim(),
      arguments: commandArgs,
    })
  }

  return (
    <div className="mt-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Slash Commands
      </div>
      <div className="mt-2 space-y-1">
        {commands.slice(0, 12).map((c) => (
          <button
            key={c.name}
            className="w-full rounded-md border border-border bg-card px-2 py-2 text-left text-xs hover:bg-accent/20"
            onClick={() => onCommandToRunChange(c.name)}
          >
            <div className="font-semibold">/{c.name}</div>
            {c.description ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {c.description}
              </div>
            ) : null}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={commandToRun}
          onChange={(e) => onCommandToRunChange(e.target.value)}
          placeholder="command"
        />
        <Input
          value={commandArgs}
          onChange={(e) => onCommandArgsChange(e.target.value)}
          placeholder="args"
        />
        <Button size="sm" onClick={handleRunCommand}>
          Run
        </Button>
      </div>
    </div>
  )
})