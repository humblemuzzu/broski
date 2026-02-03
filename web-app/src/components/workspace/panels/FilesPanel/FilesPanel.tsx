import * as React from "react"

import { useConnectionStore } from "@/stores/connection-store"
import { useFilesStore, type BrowseItem } from "@/stores/files-store"

import { FilesHeader } from "./FilesHeader"
import { PathNavigator } from "./PathNavigator"
import { FileTree } from "./FileTree"
import { FilePreview } from "./FilePreview"

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

  const handleRefresh = React.useCallback(() => {
    send({ type: "browse", path: pathInput, projectPath } as any)
  }, [pathInput, projectPath, send])

  const handleRootClick = React.useCallback(() => {
    setPathInput(projectPath)
    send({ type: "browse", path: projectPath, projectPath } as any)
  }, [projectPath, send])

  const handleItemSelect = React.useCallback((item: BrowseItem) => {
    const isDir = guessIsDir(item)
    const path = guessPath(item)
    
    if (!path) return
    
    if (isDir) {
      send({ type: "browse", path, projectPath } as any)
      setPathInput(path)
      return
    }
    
    selectFile(path)
    send({ type: "read_file", path, projectPath } as any)
  }, [projectPath, selectFile, send])

  return (
    <div className="flex h-full flex-col">
      <FilesHeader currentPath={projectPath} onRefresh={handleRefresh} />

      <PathNavigator
        pathInput={pathInput}
        onPathChange={setPathInput}
        onRootClick={handleRootClick}
        cwdPath={cwdPath}
      />

      <div className="flex min-h-0 flex-1">
        <div className="w-[360px] shrink-0 border-r border-[var(--panel-border)]">
          <FileTree
            items={items}
            selectedFilePath={selectedFilePath ?? undefined}
            onItemSelect={handleItemSelect}
          />
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-3">
          <FilePreview
            path={selectedFilePath ?? undefined}
            content={fileContent?.content ?? null}
          />
        </div>
      </div>
    </div>
  )
}