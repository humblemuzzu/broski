import * as React from "react"
import { File, Folder, FolderOpen } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useFilesStore, type BrowseItem } from "@/stores/files-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function guessIsDir(item: BrowseItem) {
  if (typeof item.isDir === "boolean") return item.isDir
  if (typeof item.isFile === "boolean") return !item.isFile
  if (typeof item.kind === "string") return item.kind === "dir"
  if (typeof item.type === "string") return item.type === "directory"
  return false
}

function guessPath(item: BrowseItem) {
  return (item.path as string | undefined) ?? (item.name as string | undefined)
}

export function FilesPanel({ projectPath }: { projectPath: string }) {
  const send = useConnectionStore((s) => s.send)
  const cwdPath = useFilesStore((s) => s.cwdPath)
  const items = useFilesStore((s) => s.items)
  const selectedFilePath = useFilesStore((s) => s.selectedFilePath)
  const fileContent = useFilesStore((s) => s.fileContent)
  const selectFile = useFilesStore((s) => s.selectFile)

  const [pathInput, setPathInput] = React.useState(projectPath)

  React.useEffect(() => {
    send({ type: "browse", path: projectPath, projectPath } as any)
    setPathInput(projectPath)
  }, [projectPath, send])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Files</div>
          <div className="mt-1 text-xs text-muted-foreground">{projectPath}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              send({ type: "browse", path: pathInput, projectPath } as any)
            }
          >
            Go
          </Button>
        </div>
      </div>

      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] p-3">
        <div className="flex items-center gap-2">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder={projectPath}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPathInput(projectPath)
              send({ type: "browse", path: projectPath, projectPath } as any)
            }}
          >
            Root
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Browsing: {cwdPath ?? "(loading…)"}{" "}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[360px] shrink-0 border-r border-[var(--panel-border)]">
          <div className="h-full overflow-auto">
            <div className="space-y-1 p-2">
              {items.map((item, idx) => {
                const isDir = guessIsDir(item)
                const p = guessPath(item) ?? `item-${idx}`
                const active = selectedFilePath === p
                return (
                  <button
                    key={`${p}:${idx}`}
                    className={[
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                      active
                        ? "bg-[var(--sidebar-item-active)]"
                        : "hover:bg-[var(--sidebar-item-hover)]",
                    ].join(" ")}
                    onClick={() => {
                      if (isDir) {
                        send({ type: "browse", path: p, projectPath } as any)
                        setPathInput(p)
                        return
                      }
                      selectFile(p)
                      send({ type: "read_file", path: p, projectPath } as any)
                    }}
                  >
                    {isDir ? (
                      active ? (
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Folder className="h-4 w-4 text-muted-foreground" />
                      )
                    ) : (
                      <File className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1 truncate">
                      {(item.name as string | undefined) ?? p}
                    </div>
                  </button>
                )
              })}
              {items.length === 0 ? (
                <div className="rounded-md border border-[var(--panel-border)] bg-[var(--panel)] p-3 text-sm text-muted-foreground">
                  No files loaded yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-3">
          <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              {selectedFilePath ?? "Select a file"}
            </div>
            {fileContent ? (
              <pre className="mt-3 max-h-[70vh] overflow-auto whitespace-pre rounded-md bg-black/20 p-3 text-xs">
                {fileContent.content}
              </pre>
            ) : (
              <div className="mt-3 text-sm text-muted-foreground">
                File content will show here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

