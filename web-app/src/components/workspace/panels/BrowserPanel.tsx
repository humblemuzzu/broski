import * as React from "react"
import { ExternalLink, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function BrowserPanel({ projectPath }: { projectPath: string }) {
  const [url, setUrl] = React.useState("http://localhost:3000")
  const [reloadKey, setReloadKey] = React.useState(0)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="text-sm font-semibold">Preview</div>
        <div className="mt-1 text-xs text-muted-foreground">{projectPath}</div>
      </div>

      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] p-3">
        <div className="flex items-center gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          If the page refuses to load in an iframe (X-Frame-Options), we’ll add the bridge proxy tier next.
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3">
        <div className="h-full w-full overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] shadow-[var(--shadow-panel)]">
          <iframe
            key={reloadKey}
            src={url}
            title="Preview"
            className="h-full w-full"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        </div>
      </div>
    </div>
  )
}

