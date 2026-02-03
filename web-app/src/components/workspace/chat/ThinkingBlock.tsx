import * as React from "react"

export interface ThinkingBlockProps {
  content: string
  defaultExpanded?: boolean
}

export const ThinkingBlock = React.memo(function ThinkingBlock({
  content,
  defaultExpanded = false,
}: ThinkingBlockProps) {
  return (
    <details className="mt-2" open={defaultExpanded}>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Thinking
      </summary>
      <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
        {content}
      </div>
    </details>
  )
})