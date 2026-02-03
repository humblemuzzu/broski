import * as React from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface ChatInputFormProps {
  onSend: (message: string) => void
  placeholder?: string
}

export const ChatInputForm = React.memo(function ChatInputForm({
  onSend,
  placeholder = "Message…",
}: ChatInputFormProps) {
  const [value, setValue] = React.useState("")

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!value.trim()) return
      onSend(value)
      setValue("")
    },
    [value, onSend]
  )

  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value)
    },
    []
  )

  return (
    <form
      className="border-t border-[var(--panel-border)] bg-[var(--panel-header)] p-3"
      onSubmit={handleSubmit}
    >
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
        />
        <Button type="submit" size="icon">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
})