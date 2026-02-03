import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { BookText, Copy, Send } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useChatStore } from "@/stores/chat-store"
import { useSpecStore } from "@/stores/spec-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

function normalizeProjectKey(projectPath: string | null): string {
  return projectPath ?? ""
}

export function SpecPanel({ projectPath }: { projectPath: string }) {
  const send = useConnectionStore((s) => s.send)
  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const selectedSessionAgent = useSessionsStore((s) => s.selectedSessionAgent)
  const getCwdFor = useSessionsStore((s) => s.getCwdFor)
  const appendUserMessage = useChatStore((s) => s.appendUserMessage)

  const getSpec = useSpecStore((s) => s.getSpec)
  const setSpec = useSpecStore((s) => s.setSpec)

  const key = normalizeProjectKey(projectPath)
  const [value, setValue] = React.useState(() => getSpec(key))

  // Keep local state in sync if project changes.
  React.useEffect(() => {
    setValue(getSpec(key))
  }, [getSpec, key])

  // Debounced persist.
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSpec(key, value)
    }, 300)
    return () => window.clearTimeout(t)
  }, [key, setSpec, value])

  const canSendToSession = Boolean(selectedSessionId && selectedSessionAgent)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="flex items-center gap-2">
          <BookText className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Spec</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {projectPath}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value)
              } catch {
                // ignore
              }
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canSendToSession || value.trim().length === 0}
            onClick={() => {
              if (!selectedSessionId || !selectedSessionAgent) return
              const cwd = getCwdFor(selectedSessionAgent, selectedSessionId) ?? projectPath
              const content = `Project spec / notes:\n\n${value.trim()}`

              appendUserMessage(`${selectedSessionAgent}:${selectedSessionId}` as any, content)

              if (selectedSessionAgent === "claude-code") {
                send({
                  type: "cc_chat",
                  sessionId: selectedSessionId,
                  prompt: content,
                  cwd,
                } as any)
              } else if (selectedSessionAgent === "codex") {
                send({
                  type: "cx_chat",
                  threadId: selectedSessionId,
                  prompt: content,
                  cwd,
                } as any)
              } else {
                send({
                  type: "chat",
                  sessionId: selectedSessionId,
                  content,
                  projectPath: cwd,
                } as any)
              }
            }}
          >
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
        <div className="min-h-0 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] shadow-[var(--shadow-panel)]">
          <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-3 py-2 text-xs font-semibold text-muted-foreground">
            Editor
          </div>
          <div className="h-full p-2">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={[
                "# Spec",
                "",
                "- Goals",
                "- Constraints",
                "- Acceptance criteria",
                "",
                "Tip: use the Send button to share with the selected session.",
              ].join("\n")}
              className="h-full min-h-0 font-mono text-xs leading-relaxed"
            />
          </div>
        </div>

        <div className="min-h-0 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] shadow-[var(--shadow-panel)]">
          <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-3 py-2 text-xs font-semibold text-muted-foreground">
            Preview
          </div>
          <div className="h-full overflow-auto p-4 text-sm">
            {value.trim().length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Write markdown on the left to preview here.
              </div>
            ) : (
              <div className="prose prose-invert max-w-none prose-pre:bg-black/20">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {value}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
