import * as React from "react"
import { Button } from "@/components/ui/button"

interface PortScannerProps {
  scanning: boolean
  results: Array<{ port: number; ok: boolean }>
  onScan: () => void
  onSelectPort: (port: number) => void
  onDetectFromTerminal: () => void
}

export const PortScanner = React.memo<PortScannerProps>(({
  scanning,
  results,
  onScan,
  onSelectPort,
  onDetectFromTerminal,
}) => {
  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={scanning}
          onClick={onScan}
        >
          {scanning ? "Scanning…" : "Scan Ports"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDetectFromTerminal}
        >
          Detect from Terminal
        </Button>
      </div>

      {results.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {results
            .filter((r) => r.ok)
            .slice(0, 10)
            .map((r) => (
              <Button
                key={r.port}
                size="sm"
                variant="secondary"
                onClick={() => onSelectPort(r.port)}
              >
                :{r.port}
              </Button>
            ))}
          {results.filter((r) => r.ok).length === 0 && (
            <div className="text-[11px] text-muted-foreground">
              No local servers detected on common ports.
            </div>
          )}
        </div>
      )}
    </>
  )
})

PortScanner.displayName = "PortScanner"