import * as React from "react"
import { Textarea } from "@/components/ui/textarea"

type KindTab = "skills" | "commands" | "agents" | "plugins" | "hooks"

interface AutomationDetailProps {
  selectedName: string | null
  kind: KindTab
  draft: string
  onDraftChange: (value: string) => void
}

const placeholders: Record<KindTab, string> = {
  skills: "# Skill\n\nDescribe what this does…",
  commands: "# Command\n\nUsage docs…",
  agents: "# Agent\n\nSystem prompt / behavior…",
  plugins: "// Plugin file\n",
  hooks: "{\n  \n}\n",
}

export const AutomationDetail = React.memo<AutomationDetailProps>(({
  selectedName,
  kind,
  draft,
  onDraftChange,
}) => {
  const title = selectedName
    ? `Editing: ${selectedName}`
    : kind === "hooks"
      ? "Editing: hooks.json"
      : "Select an item, or type a new name and save"

  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      <div className="h-full p-3">
        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] shadow-[var(--shadow-panel)]">
          <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-3 py-2 text-xs text-muted-foreground">
            {title}
          </div>
          <div className="min-h-0 flex-1 p-2">
            <Textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder={placeholders[kind]}
              className="h-full min-h-0 resize-none font-mono text-xs leading-relaxed"
            />
          </div>
        </div>
      </div>
    </div>
  )
})

AutomationDetail.displayName = "AutomationDetail"