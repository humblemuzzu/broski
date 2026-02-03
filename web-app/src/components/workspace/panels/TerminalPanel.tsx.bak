import * as React from "react"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import { TerminalSquare } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useTerminalStore } from "@/stores/terminal-store"
import { Button } from "@/components/ui/button"

import "@xterm/xterm/css/xterm.css"

export function TerminalPanel({ projectPath }: { projectPath: string }) {
  const send = useConnectionStore((s) => s.send)
  const activePtyId = useTerminalStore((s) => s.activePtyId)
  const setActivePtyId = useTerminalStore((s) => s.setActivePtyId)
  const outputState = useTerminalStore(
    (s) => (activePtyId ? s.outputByPty[activePtyId] : undefined) ?? null
  )

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const termRef = React.useRef<Terminal | null>(null)
  const fitRef = React.useRef<FitAddon | null>(null)
  const lastSeqRef = React.useRef<number>(0)

  React.useEffect(() => {
    send({ type: "list_pty", projectPath } as any)
    // If we don't have one yet, create a default PTY.
    if (!activePtyId) {
      send({
        type: "create_pty",
        title: "Terminal",
        cwd: projectPath,
        projectPath,
      } as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  React.useEffect(() => {
    if (!containerRef.current) return
    if (termRef.current) return

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 12,
      theme: {
        background: "transparent",
        foreground: "rgba(240,240,242,0.92)",
        cursor: "rgba(232,232,234,0.9)",
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())

    term.open(containerRef.current)
    fit.fit()

    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(containerRef.current)

    term.onData((data) => {
      if (!activePtyId) return
      send({ type: "pty_input", ptyId: activePtyId, data } as any)
    })

    termRef.current = term
    fitRef.current = fit

    return () => {
      ro.disconnect()
      try {
        term.dispose()
      } catch {
        // ignore
      }
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send])

  React.useEffect(() => {
    if (!activePtyId) return
    // Connect when active pty changes.
    send({ type: "pty_connect", ptyId: activePtyId, projectPath } as any)

    const term = termRef.current
    const fit = fitRef.current
    if (term && fit) {
      fit.fit()
      send({
        type: "pty_resize",
        ptyId: activePtyId,
        rows: term.rows,
        cols: term.cols,
        projectPath,
      } as any)
    }

    return () => {
      send({ type: "pty_disconnect", ptyId: activePtyId } as any)
    }
  }, [activePtyId, projectPath, send])

  React.useEffect(() => {
    if (!activePtyId) return
    if (!outputState) return
    const term = termRef.current
    if (!term) return
    if (outputState.seq === lastSeqRef.current) return
    lastSeqRef.current = outputState.seq
    term.write(outputState.lastChunk)
  }, [activePtyId, outputState])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Terminal</div>
            <div className="text-xs text-muted-foreground">{projectPath}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActivePtyId(null)
              send({
                type: "create_pty",
                title: "Terminal",
                cwd: projectPath,
                projectPath,
              } as any)
            }}
          >
            New
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-3">
        <div className="h-full w-full rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-2 shadow-[var(--shadow-panel)]">
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>

      {outputState?.error ? (
        <div className="border-t border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-2 text-xs text-destructive">
          {outputState.error}
        </div>
      ) : null}
    </div>
  )
}
