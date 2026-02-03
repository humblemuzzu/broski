import * as React from "react"
import { Button } from "@/components/ui/button"

type Tab = "mcp" | "tools" | "providers"

interface IntegrationsTabNavProps {
  value: Tab
  onChange: (tab: Tab) => void
}

export const IntegrationsTabNav = React.memo<IntegrationsTabNavProps>(({ value, onChange }) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={value === "mcp" ? "secondary" : "outline"} onClick={() => onChange("mcp")}>
        MCP
      </Button>
      <Button size="sm" variant={value === "tools" ? "secondary" : "outline"} onClick={() => onChange("tools")}>
        Tools
      </Button>
      <Button size="sm" variant={value === "providers" ? "secondary" : "outline"} onClick={() => onChange("providers")}>
        Providers
      </Button>
    </div>
  )
})

IntegrationsTabNav.displayName = "IntegrationsTabNav"