import * as React from "react"
import { CodexApprovalCard } from "./CodexApprovalCard"
import { CodexUserInputCard } from "./CodexUserInputCard"

interface CodexRequestsProps {
  sessionId: string
  approvals: Array<{ requestId: string; method: string; params: any }>
  userInputs: Array<{ 
    requestId: string
    questions: Array<{ 
      id: string
      question: string
      options: Array<{ label: string; description?: string }>
    }>
  }>
  userInputAnswers: Record<string, Record<string, { selected: string[]; other?: string }>>
  onUserInputAnswerChange: (requestId: string, questionId: string, answer: { selected: string[]; other?: string }) => void
  onSend: (message: any) => void
  onResolveRequest: (sessionId: string, requestId: string) => void
}

export const CodexRequests = React.memo<CodexRequestsProps>(function CodexRequests({
  sessionId,
  approvals,
  userInputs,
  userInputAnswers,
  onUserInputAnswerChange,
  onSend,
  onResolveRequest,
}) {
  // Only show if there are requests and this is a Codex session
  if ((approvals.length === 0 && userInputs.length === 0)) {
    return null
  }

  const hasNoRequests = approvals.length === 0 && userInputs.length === 0

  return (
    <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Codex · Requests
      </div>

      {approvals.length > 0 && (
        <div className="mt-3 space-y-2">
          {approvals.slice(0, 10).map((r) => (
            <CodexApprovalCard
              key={r.requestId}
              approval={r}
              sessionId={sessionId}
              onSend={onSend}
              onResolve={onResolveRequest}
            />
          ))}
        </div>
      )}

      {userInputs.length > 0 && (
        <div className="mt-3 space-y-2">
          {userInputs.slice(0, 5).map((r) => (
            <CodexUserInputCard
              key={r.requestId}
              request={r}
              sessionId={sessionId}
              answers={userInputAnswers[r.requestId] ?? {}}
              onAnswerChange={(questionId, answer) => 
                onUserInputAnswerChange(r.requestId, questionId, answer)
              }
              onSend={onSend}
              onResolve={onResolveRequest}
            />
          ))}
        </div>
      )}

      {hasNoRequests && (
        <div className="mt-3 text-xs text-muted-foreground">
          No pending Codex requests.
        </div>
      )}
    </div>
  )
})