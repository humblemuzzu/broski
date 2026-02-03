import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface CodexUserInputRequest {
  requestId: string
  questions: Array<{ 
    id: string
    question: string
    options: Array<{ label: string; description?: string }>
  }>
}

interface CodexUserInputCardProps {
  request: CodexUserInputRequest
  sessionId: string
  answers: Record<string, { selected: string[]; other?: string }>
  onAnswerChange: (questionId: string, answer: { selected: string[]; other?: string }) => void
  onSend: (message: any) => void
  onResolve: (sessionId: string, requestId: string) => void
}

export const CodexUserInputCard = React.memo<CodexUserInputCardProps>(function CodexUserInputCard({
  request,
  sessionId,
  answers,
  onAnswerChange,
  onSend,
  onResolve,
}) {
  const handleSubmit = () => {
    const answersForReq = answers || {}
    onSend({
      type: "cx_user_input_response",
      requestId: request.requestId,
      answers: answersForReq,
    })
    onResolve(sessionId, request.requestId)
  }

  const handleDismiss = () => {
    onResolve(sessionId, request.requestId)
  }

  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-xs font-semibold">User Input</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        requestId: {request.requestId}
      </div>

      <div className="mt-2 space-y-2">
        {request.questions.map((q) => {
          const draft = answers[q.id] ?? {
            selected: [],
            other: "",
          }
          return (
            <div
              key={q.id}
              className="rounded-md border border-border bg-[var(--panel)] p-2"
            >
              <div className="text-xs font-semibold">
                {q.question}
              </div>
              {q.options.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {q.options.map((o) => {
                    const checked = draft.selected.includes(o.label)
                    return (
                      <label
                        key={o.label}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-2 py-2 text-xs hover:bg-accent/20"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const nextSelected = e.target.checked
                              ? [...draft.selected, o.label]
                              : draft.selected.filter((x) => x !== o.label)
                            onAnswerChange(q.id, {
                              selected: nextSelected,
                              other: draft.other,
                            })
                          }}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold">{o.label}</div>
                          {o.description ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {o.description}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    )
                  })}
                </div>
              ) : null}

              <div className="mt-2">
                <Input
                  value={draft.other ?? ""}
                  onChange={(e) => {
                    const other = e.target.value
                    onAnswerChange(q.id, {
                      selected: draft.selected,
                      other,
                    })
                  }}
                  placeholder="Other (optional)"
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={handleSubmit}>
          Submit
        </Button>
        <Button size="sm" variant="outline" onClick={handleDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
})