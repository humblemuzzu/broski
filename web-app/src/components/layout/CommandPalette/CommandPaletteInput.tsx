import * as React from "react"
import { CornerDownLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface CommandPaletteInputProps {
  query: string
  onQueryChange: (query: string) => void
  onSubmit: () => void
  inputRef?: React.RefObject<HTMLInputElement>
  hint?: string
}

export const CommandPaletteInput = React.memo<CommandPaletteInputProps>(({
  query,
  onQueryChange,
  onSubmit,
  inputRef,
  hint,
}) => {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="p-3">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search actions, or type /command…"
        />
        <Button type="submit" size="icon" variant="secondary" aria-label="Run">
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </div>
      {hint && (
        <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </form>
  )
})

CommandPaletteInput.displayName = "CommandPaletteInput"