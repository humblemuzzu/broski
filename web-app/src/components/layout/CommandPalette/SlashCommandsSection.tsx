import * as React from "react"

import { CommandPaletteItem } from "./CommandPaletteItem"

type SlashCommand = {
  name: string
  description?: string
  builtin?: boolean
}

interface SlashCommandsSectionProps {
  commands: SlashCommand[]
  canExecute: boolean
  onCommandSelect: (command: SlashCommand) => void
}

export const SlashCommandsSection = React.memo<SlashCommandsSectionProps>(({ 
  commands, 
  canExecute,
  onCommandSelect 
}) => {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
        OpenCode Slash Commands
      </div>
      <div className="space-y-1">
        {commands.map((command) => (
          <CommandPaletteItem
            key={command.name}
            label={`/${command.name}`}
            hint={command.description}
            shortcut={command.builtin ? "builtin" : "custom"}
            disabled={!canExecute}
            onSelect={() => onCommandSelect(command)}
          />
        ))}
        {commands.length === 0 && (
          <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
            No commands found.
          </div>
        )}
      </div>
    </div>
  )
})

SlashCommandsSection.displayName = "SlashCommandsSection"