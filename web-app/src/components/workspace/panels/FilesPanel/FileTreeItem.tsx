import * as React from "react"
import { File, Folder, FolderOpen } from "lucide-react"

import type { BrowseItem } from "@/stores/files-store"

interface FileTreeItemProps {
  item: BrowseItem
  depth?: number
  isSelected: boolean
  onSelect: () => void
}

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

export const FileTreeItem = React.memo<FileTreeItemProps>(({ 
  item, 
  depth = 0,
  isSelected, 
  onSelect
}) => {
  const isDir = guessIsDir(item)
  const path = guessPath(item) ?? "unknown"
  
  const Icon = isDir ? (isSelected ? FolderOpen : Folder) : File
  
  return (
    <button
      className={[
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
        isSelected
          ? "bg-[var(--sidebar-item-active)]"
          : "hover:bg-[var(--sidebar-item-hover)]",
      ].join(" ")}
      onClick={onSelect}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1 truncate">
        {(item.name as string | undefined) ?? path}
      </div>
    </button>
  )
})

FileTreeItem.displayName = "FileTreeItem"