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
    <div className="min-w-0 flex-1 overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
      <div className="h-full p-3">
        <div 
          className="flex h-full flex-col overflow-hidden rounded-lg"
          style={{ 
            backgroundColor: '#171717', 
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}
        >
          <div 
            className="px-3 py-2 text-xs"
            style={{ 
              backgroundColor: '#0f0f0f', 
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              color: '#808080'
            }}
          >
            {title}
          </div>
          <div className="min-h-0 flex-1 p-2">
            <Textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder={placeholders[kind]}
              className="h-full min-h-0 resize-none font-mono text-xs leading-relaxed"
              style={{ 
                backgroundColor: '#0f0f0f', 
                color: '#e8e8e8',
                border: '1px solid rgba(255,255,255,0.06)'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
})

AutomationDetail.displayName = "AutomationDetail"