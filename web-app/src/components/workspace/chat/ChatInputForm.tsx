import * as React from "react"
import { Send, Paperclip, Slash } from "lucide-react"

export interface ChatInputFormProps {
  onSend: (message: string) => void
  placeholder?: string
}

export const ChatInputForm = React.memo(function ChatInputForm({
  onSend,
  placeholder = "Type a message...",
}: ChatInputFormProps) {
  const [value, setValue] = React.useState("")
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  const handleSubmit = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault()
      if (!value.trim()) return
      onSend(value)
      setValue("")
    },
    [value, onSend]
  )

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  // Auto-resize textarea
  React.useEffect(() => {
    const textarea = inputRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px"
    }
  }, [value])

  return (
    <div className="px-4 py-3 bg-[var(--bg-surface)]">
      <form onSubmit={handleSubmit}>
        <div className="flex items-end gap-2 p-2 rounded-xl bg-[var(--bg-elevated)] 
                        border border-[var(--border-subtle)] focus-within:border-[var(--accent)]
                        transition-all">
          {/* Attachment button */}
          <button
            type="button"
            className="p-2 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-muted)] 
                       hover:bg-[var(--bg-hover)] transition-all flex-shrink-0"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          
          {/* Slash command button */}
          <button
            type="button"
            className="p-2 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-muted)] 
                       hover:bg-[var(--bg-hover)] transition-all flex-shrink-0"
            title="Commands"
          >
            <Slash className="h-4 w-4" />
          </button>
          
          {/* Input */}
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 bg-transparent border-0 resize-none text-sm text-[var(--text)]
                       placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-0
                       min-h-[36px] py-2"
          />
          
          {/* Send button */}
          <button
            type="submit"
            disabled={!value.trim()}
            className={[
              "p-2.5 rounded-lg transition-all flex-shrink-0",
              value.trim()
                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                : "bg-[var(--bg-hover)] text-[var(--text-faint)] cursor-not-allowed"
            ].join(" ")}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        
        {/* Hint */}
        <div className="mt-2 flex items-center justify-between px-1">
          <span className="text-[10px] text-[var(--text-faint)]">
            Press Enter to send, Shift+Enter for new line
          </span>
        </div>
      </form>
    </div>
  )
})
