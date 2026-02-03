import * as React from "react"

import type { BrowseItem } from "@/stores/files-store"
import { FileTreeItem } from "./FileTreeItem"

interface FileTreeProps {
  items: BrowseItem[]
  selectedFilePath?: string | null
  onItemSelect: (item: BrowseItem) => void
}

function guessPath(item: BrowseItem) {
  return (item.path as string | undefined) ?? (item.name as string | undefined)
}

export const FileTree = React.memo<FileTreeProps>(({ 
  items, 
  selectedFilePath, 
  onItemSelect 
}) => {
  return (
    <div className="h-full overflow-auto">
      <div className="space-y-1 p-2">
        {items.map((item, idx) => {
          const path = guessPath(item) ?? `item-${idx}`
          return (
            <FileTreeItem
              key={`${path}:${idx}`}
              item={item}
              isSelected={selectedFilePath === path}
              onSelect={() => onItemSelect(item)}
            />
          )
        })}
        {items.length === 0 && (
          <div className="rounded-md border border-[var(--panel-border)] bg-[var(--panel)] p-3 text-sm text-muted-foreground">
            No files loaded yet.
          </div>
        )}
      </div>
    </div>
  )
})

FileTree.displayName = "FileTree"