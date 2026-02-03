import * as React from "react"
import { Button } from "@/components/ui/button"

type KindTab = "skills" | "commands" | "agents" | "plugins" | "hooks"

interface KindTabsProps {
  kinds: KindTab[]
  value: KindTab
  onChange: (kind: KindTab) => void
}

const kindLabels: Record<KindTab, string> = {
  skills: "Skills",
  commands: "Commands", 
  agents: "Agents",
  plugins: "Plugins",
  hooks: "Hooks",
}

export const KindTabs = React.memo<KindTabsProps>(({ kinds, value, onChange }) => {
  return (
    <>
      <div className="mx-2 h-6 w-px bg-[var(--panel-border)]" />
      {kinds.map((k) => (
        <Button
          key={k}
          size="sm"
          variant={value === k ? "secondary" : "ghost"}
          onClick={() => onChange(k)}
        >
          {kindLabels[k]}
        </Button>
      ))}
    </>
  )
})

KindTabs.displayName = "KindTabs"