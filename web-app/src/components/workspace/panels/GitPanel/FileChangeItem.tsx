import * as React from "react"

interface FileChangeItemProps {
  file: { path: string; status: string; added?: number; removed?: number }
  isSelected: boolean
  onSelect: () => void
}

export const FileChangeItem = React.memo<FileChangeItemProps>(({ 
  file, 
  isSelected, 
  onSelect 
}) => {
  const activeClass = isSelected 
    ? "ring-1 ring-ring/35" 
    : "hover:bg-accent hover:text-accent-foreground"

  return (
    <button
      className={[
        "flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-2 text-left text-sm",
        activeClass
      ].join(" ")}
      onClick={onSelect}
    >
      <div className="min-w-0">
        <div className="truncate font-semibold">{file.path}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {file.status} · +{file.added ?? 0} / -{file.removed ?? 0}
        </div>
      </div>
      <div className="shrink-0 text-[11px] text-muted-foreground">
        {file.status}
      </div>
    </button>
  )
})

FileChangeItem.displayName = "FileChangeItem"