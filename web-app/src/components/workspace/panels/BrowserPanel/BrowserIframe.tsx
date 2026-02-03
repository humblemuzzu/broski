import * as React from "react"

interface BrowserIframeProps {
  url: string
  useProxy: boolean
  iframeRef: React.RefObject<HTMLIFrameElement>
  reloadKey: number
}

function toProxySrc(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    const host = u.hostname
    const isLocal =
      host === "localhost" || host === "127.0.0.1" || host === "::1"
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80))
    if (!isLocal) return null
    if (!Number.isFinite(port) || port < 1 || port > 65535) return null
    return `/proxy/${port}${u.pathname}${u.search}${u.hash}`
  } catch {
    return null
  }
}

export const BrowserIframe = React.memo<BrowserIframeProps>(({
  url,
  useProxy,
  iframeRef,
  reloadKey,
}) => {
  const proxySrc = useProxy ? toProxySrc(url) : null
  const iframeSrc = proxySrc ?? url

  return (
    <div className="min-h-0 flex-1 p-3">
      <div className="h-full w-full overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] shadow-[var(--shadow-panel)]">
        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={iframeSrc}
          title="Preview"
          className="h-full w-full"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        />
      </div>
    </div>
  )
})

BrowserIframe.displayName = "BrowserIframe"