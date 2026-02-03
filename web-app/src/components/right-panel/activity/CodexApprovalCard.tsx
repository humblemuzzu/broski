import * as React from "react"
import { Button } from "@/components/ui/button"

interface CodexApproval {
  requestId: string
  method: string
  params: any
}

interface CodexApprovalCardProps {
  approval: CodexApproval
  sessionId: string
  onSend: (message: any) => void
  onResolve: (sessionId: string, requestId: string) => void
}

export const CodexApprovalCard = React.memo<CodexApprovalCardProps>(function CodexApprovalCard({
  approval,
  sessionId,
  onSend,
  onResolve,
}) {
  const handleResponse = (response: "once" | "always" | "reject") => {
    onSend({
      type: "cx_permission_response",
      requestId: approval.requestId,
      response: response,
    })
    onResolve(sessionId, approval.requestId)
  }

  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-xs font-semibold">Approval</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {approval.method}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        requestId: {approval.requestId}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          Details
        </summary>
        <pre className="mt-2 max-h-[180px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {JSON.stringify(approval.params, null, 2)}
        </pre>
      </details>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => handleResponse("once")}
        >
          Allow Once
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleResponse("always")}
        >
          Always
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleResponse("reject")}
        >
          Reject
        </Button>
      </div>
    </div>
  )
})