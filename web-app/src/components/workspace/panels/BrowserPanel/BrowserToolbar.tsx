import * as React from "react"
import { ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface BrowserToolbarProps {
  url: string
  onUrlChange: (url: string) => void
  onUrlSubmit: () => void
  useProxy: boolean
  onProxyToggle: () => void
  proxyEligible: boolean
  onReload: () => void
  onOpenExternal: () => void
}

export const BrowserToolbar = React.memo<BrowserToolbarProps>(({
  url,
  onUrlChange,
  useProxy,
  onProxyToggle,
  proxyEligible,
  onReload,
  onOpenExternal,
}) => {
  return (
    <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] p-3">
      <div className="flex items-center gap-2">
        <Input value={url} onChange={(e) => onUrlChange(e.target.value)} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onUrlChange("http://localhost:3000")}
        >
          :3000
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onUrlChange("http://localhost:5173")}
        >
          :5173
        </Button>
        <label className="ml-1 flex select-none items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={useProxy}
            onChange={(e) => onProxyToggle()}
            disabled={!proxyEligible}
          />
          proxy
        </label>
        <Button variant="outline" size="sm" onClick={onReload}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reload
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenExternal}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open
        </Button>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Saved per project. Turn on "proxy" when an iframe is blocked (X-Frame-Options/CSP).
      </div>
    </div>
  )
})

BrowserToolbar.displayName = "BrowserToolbar"