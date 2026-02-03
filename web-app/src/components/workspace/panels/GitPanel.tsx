import * as React from "react"
import { GitBranch, RefreshCw } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useGitStore } from "@/stores/git-store"
import { Button } from "@/components/ui/button"

export function GitPanel({ projectPath }: { projectPath: string }) {
  const send = useConnectionStore((s) => s.send)
  const vcs = useGitStore((s) => s.vcs)
  const fileStatus = useGitStore((s) => s.fileStatus)

  React.useEffect(() => {
    send({ type: "get_vcs", projectPath } as any)
    send({ type: "get_file_status", projectPath } as any)
  }, [projectPath, send])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Git</div>
            <div className="mt-1 text-xs text-muted-foreground">{projectPath}</div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            send({ type: "get_vcs", projectPath } as any)
            send({ type: "get_file_status", projectPath } as any)
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-4">
          <div className="text-xs font-semibold text-muted-foreground">Branch</div>
          <div className="mt-2 text-sm font-semibold">{vcs?.branch ?? "—"}</div>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-4">
          <div className="text-xs font-semibold text-muted-foreground">
            Changes ({fileStatus.length})
          </div>
          <div className="mt-3 space-y-2">
            {fileStatus.map((f, idx) => (
              <div
                key={`${f.path ?? "file"}:${idx}`}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="min-w-0 truncate">
                  {(f.path as string | undefined) ?? "unknown"}
                </div>
                <div className="ml-3 shrink-0 text-xs text-muted-foreground">
                  {(f.status as string | undefined) ?? ""}
                </div>
              </div>
            ))}
            {fileStatus.length === 0 ? (
              <div className="text-sm text-muted-foreground">Clean.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

