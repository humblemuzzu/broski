import * as React from "react"
import { usePreviewStore } from "@/stores/preview-store"
import { useTerminalStore } from "@/stores/terminal-store"
import { BrowserToolbar } from "./BrowserToolbar"
import { PortScanner } from "./PortScanner"
import { PresetManager } from "./PresetManager"
import { BrowserIframe } from "./BrowserIframe"

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

async function probeProxyPort(port: number, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`/proxy/${port}/`, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
    })
    // 502 comes from proxy failing to connect (our implementation).
    if (res.status === 502) return false
    // Any other response implies something is listening.
    return res.status >= 200 && res.status < 600
  } catch {
    return false
  } finally {
    window.clearTimeout(t)
  }
}

function extractPortsFromText(text: string): number[] {
  const ports = new Set<number>()
  const add = (p: any) => {
    const n = Number(p)
    if (Number.isFinite(n) && n >= 1 && n <= 65535) ports.add(n)
  }
  const re1 = /(https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)[^\s'"]*)/gi
  let m: RegExpExecArray | null
  while ((m = re1.exec(text))) add(m[2])
  const re2 = /\b(?:localhost|127\.0\.0\.1):(\d+)\b/gi
  while ((m = re2.exec(text))) add(m[1])
  return Array.from(ports).sort((a, b) => a - b)
}

export function BrowserPanel({ projectPath }: { projectPath: string }) {
  const getUrl = usePreviewStore((s) => s.getUrl)
  const setUrlPersisted = usePreviewStore((s) => s.setUrl)
  const getProxyEnabled = usePreviewStore((s) => s.getProxyEnabled)
  const setProxyEnabled = usePreviewStore((s) => s.setProxyEnabled)
  const presets = usePreviewStore((s) => s.presetsByProject[projectPath] ?? [])
  const addPreset = usePreviewStore((s) => s.addPreset)
  const removePreset = usePreviewStore((s) => s.removePreset)
  const renamePreset = usePreviewStore((s) => s.renamePreset)
  const movePreset = usePreviewStore((s) => s.movePreset)

  const ptys = useTerminalStore((s) => s.ptys)
  const outputByPty = useTerminalStore((s) => s.outputByPty)

  const [url, setUrl] = React.useState(() => getUrl(projectPath))
  const [reloadKey, setReloadKey] = React.useState(0)
  const [useProxy, setUseProxy] = React.useState(() => getProxyEnabled(projectPath))
  const [presetName, setPresetName] = React.useState("")

  const [scanBusy, setScanBusy] = React.useState(false)
  const [scanResults, setScanResults] = React.useState<Array<{ port: number; ok: boolean }>>([])

  const iframeRef = React.useRef<HTMLIFrameElement>(null)

  React.useEffect(() => {
    setUrl(getUrl(projectPath))
    setUseProxy(getProxyEnabled(projectPath))
  }, [getProxyEnabled, getUrl, projectPath])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setUrlPersisted(projectPath, url)
    }, 250)
    return () => window.clearTimeout(t)
  }, [projectPath, setUrlPersisted, url])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setProxyEnabled(projectPath, useProxy)
    }, 150)
    return () => window.clearTimeout(t)
  }, [projectPath, setProxyEnabled, useProxy])

  const proxyEligible = toProxySrc(url) != null

  const handleScan = async () => {
    setScanBusy(true)
    try {
      const candidates = [
        3000, 3001, 3002,
        5173, 5174, 4173,
        8080, 8000, 5000, 4000,
        9000, 4200, 8888,
      ]
      const next: Array<{ port: number; ok: boolean }> = []
      // Small concurrency to keep UI responsive.
      const concurrency = 4
      let idx = 0
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          for (;;) {
            const i = idx++
            if (i >= candidates.length) return
            const port = candidates[i]!
            const ok = await probeProxyPort(port, 900)
            next.push({ port, ok })
          }
        })
      )
      next.sort((a, b) => Number(b.ok) - Number(a.ok) || a.port - b.port)
      setScanResults(next)
    } finally {
      setScanBusy(false)
    }
  }

  const handleDetectFromTerminal = () => {
    const ports = new Set<number>()
    for (const [ptyId, pty] of Object.entries(ptys)) {
      if (!pty?.cwd) continue
      // Only consider terminals under the selected project.
      if (!pty.cwd.startsWith(projectPath)) continue
      const chunk = outputByPty[ptyId]?.lastChunk ?? ""
      for (const p of extractPortsFromText(chunk)) ports.add(p)
    }
    const next = Array.from(ports)
      .sort((a, b) => a - b)
      .map((p) => ({ port: p, ok: true }))
    setScanResults(next)
  }

  const handleAddPreset = () => {
    const name = presetName.trim() || "Preset"
    addPreset(projectPath, { name, url })
    setPresetName("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="text-sm font-semibold">Preview</div>
        <div className="mt-1 text-xs text-muted-foreground">{projectPath}</div>
      </div>

      <BrowserToolbar
        url={url}
        onUrlChange={setUrl}
        onUrlSubmit={() => {}}
        useProxy={useProxy}
        onProxyToggle={() => setUseProxy(!useProxy)}
        proxyEligible={proxyEligible}
        onReload={() => setReloadKey((k) => k + 1)}
        onOpenExternal={() => window.open(url, "_blank", "noopener,noreferrer")}
      />

      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] p-3">
        <PortScanner
          scanning={scanBusy}
          results={scanResults}
          onScan={handleScan}
          onSelectPort={(port) => setUrl(`http://localhost:${port}`)}
          onDetectFromTerminal={handleDetectFromTerminal}
        />

        <PresetManager
          presets={presets}
          presetName={presetName}
          onPresetNameChange={setPresetName}
          onAdd={handleAddPreset}
          onSelect={setUrl}
          onRename={(id, name) => renamePreset(projectPath, id, name)}
          onRemove={(id) => removePreset(projectPath, id)}
          onMove={(id, direction) => movePreset(projectPath, id, direction)}
        />
      </div>

      <BrowserIframe
        url={url}
        useProxy={useProxy}
        iframeRef={iframeRef}
        reloadKey={reloadKey}
      />
    </div>
  )
}