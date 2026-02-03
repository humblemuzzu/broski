import * as React from "react"

interface FilePreviewProps {
  path?: string | null
  content?: string | null
  language?: string
}

export const FilePreview = React.memo<FilePreviewProps>(({ 
  path, 
  content,
  language
}) => {
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        {path ?? "Select a file"}
      </div>
      {content ? (
        <pre className="mt-3 max-h-[70vh] overflow-auto whitespace-pre rounded-md bg-black/20 p-3 text-xs">
          {content}
        </pre>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">
          File content will show here.
        </div>
      )}
    </div>
  )
})

FilePreview.displayName = "FilePreview"