import * as React from "react"
import { OpenCodeTools } from "./OpenCodeTools"
import { PendingPermissions } from "./PendingPermissions"
import { PendingQuestions } from "./PendingQuestions"
import { CodexRequests } from "./CodexRequests"
import { ClaudeCodePermissions } from "./ClaudeCodePermissions"
import { ToastList } from "./ToastList"

// Stable empty references prevent Zustand's useSyncExternalStore from seeing
// a new snapshot on every selector call (which causes infinite re-render).
const EMPTY: never[] = []

interface ActivityModeProps {
  selectedSessionId: string | null
  selectedSessionAgent: string | null
  // OpenCode data
  ocTodos: Array<{ id: string; content: string; status: string; priority: string }>
  ocCommands: Array<{ name: string; description?: string }>
  ocAgents: Array<{ name: string }>
  commandToRun: string
  commandArgs: string
  onCommandToRunChange: (command: string) => void
  onCommandArgsChange: (args: string) => void
  // Permissions and questions
  pendingPermissionsRaw: any[]
  pendingQuestionsRaw: any[]
  ocAnswers: Record<string, string>
  onOcAnswerChange: (questionId: string, answer: string) => void
  // Codex data
  cxApprovals: Array<{ requestId: string; method: string; params: any }>
  cxUserInputs: Array<{
    requestId: string
    questions: Array<{
      id: string
      question: string
      options: Array<{ label: string; description?: string }>
    }>
  }>
  cxAnswers: Record<string, Record<string, { selected: string[]; other?: string }>>
  onCxAnswerChange: (requestId: string, questionId: string, answer: { selected: string[]; other?: string }) => void
  // Claude Code permissions
  permissionItems: Array<{
    sessionId: string
    toolUseId: string
    tool: string
    decisionReason?: string
  }>
  // Toasts
  toasts: Array<{
    id: string
    title: string
    message?: string
    createdAt: number
  }>
  onDismissToast: (id: string) => void
  // Actions
  onSend: (message: any) => void
  onResolveCodexRequest: (sessionId: string, requestId: string) => void
  onResolveClaudeCodeRequest: (sessionId: string, toolUseId: string) => void
}

export const ActivityMode = React.memo<ActivityModeProps>(function ActivityMode({
  selectedSessionId,
  selectedSessionAgent,
  ocTodos,
  ocCommands,
  ocAgents,
  commandToRun,
  commandArgs,
  onCommandToRunChange,
  onCommandArgsChange,
  pendingPermissionsRaw,
  pendingQuestionsRaw,
  ocAnswers,
  onOcAnswerChange,
  cxApprovals,
  cxUserInputs,
  cxAnswers,
  onCxAnswerChange,
  permissionItems,
  toasts,
  onDismissToast,
  onSend,
  onResolveCodexRequest,
  onResolveClaudeCodeRequest,
}) {
  return (
    <>
      {selectedSessionAgent === "opencode" && selectedSessionId && (
        <OpenCodeTools
          sessionId={selectedSessionId}
          todos={ocTodos ?? EMPTY}
          commands={ocCommands ?? EMPTY}
          agents={ocAgents ?? EMPTY}
          commandToRun={commandToRun}
          commandArgs={commandArgs}
          onCommandToRunChange={onCommandToRunChange}
          onCommandArgsChange={onCommandArgsChange}
          onSend={onSend}
        />
      )}

      <PendingPermissions
        permissions={pendingPermissionsRaw}
        sessionId={selectedSessionId ?? ""}
        sessionAgent={selectedSessionAgent ?? ""}
        onSend={onSend}
      />

      {selectedSessionAgent === "codex" && selectedSessionId && (
        <CodexRequests
          sessionId={selectedSessionId}
          approvals={cxApprovals}
          userInputs={cxUserInputs}
          userInputAnswers={cxAnswers}
          onUserInputAnswerChange={onCxAnswerChange}
          onSend={onSend}
          onResolveRequest={onResolveCodexRequest}
        />
      )}

      <PendingQuestions
        questions={pendingQuestionsRaw}
        answers={ocAnswers}
        onAnswerChange={onOcAnswerChange}
        onSend={onSend}
      />

      <ClaudeCodePermissions
        permissions={permissionItems}
        onSend={onSend}
        onResolveRequest={onResolveClaudeCodeRequest}
      />

      <ToastList
        toasts={toasts}
        onDismissToast={onDismissToast}
      />
    </>
  )
})