import * as React from "react"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"

type BackendTab = "opencode" | "claude-code" | "codex"

interface BackendTabsProps {
  value: BackendTab
  onChange: (backend: BackendTab) => void
}

export const BackendTabs = React.memo<BackendTabsProps>(({ value, onChange }) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={value === "opencode" ? "secondary" : "outline"}
        onClick={() => onChange("opencode")}
      >
        <Bot className="mr-2 h-4 w-4" />
        OpenCode
      </Button>
      <Button
        size="sm"
        variant={value === "claude-code" ? "secondary" : "outline"}
        onClick={() => onChange("claude-code")}
      >
        <Bot className="mr-2 h-4 w-4" />
        Claude Code
      </Button>
      <Button
        size="sm"
        variant={value === "codex" ? "secondary" : "outline"}
        onClick={() => onChange("codex")}
      >
        <Bot className="mr-2 h-4 w-4" />
        Codex
      </Button>
    </div>
  )
})

BackendTabs.displayName = "BackendTabs"