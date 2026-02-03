import * as React from "react"

import { useActivityStore } from "@/stores/activity-store"
import { useConnectionStore } from "@/stores/connection-store"
import { usePermissionsStore } from "@/stores/permissions-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useOpenCodeStore } from "@/stores/opencode-store"
import { useUiStore } from "@/stores/ui-store"
import { useConfigStore } from "@/stores/config-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useMcpStore } from "@/stores/mcp-store"

import { RightPanelHeader } from "./RightPanelHeader"
import { ConfigMode } from "./config/ConfigMode"
import { ActivityMode } from "./activity/ActivityMode"

// Stable empty references prevent Zustand's useSyncExternalStore from seeing
// a new snapshot on every selector call (which causes infinite re-render).
const EMPTY: never[] = []

export function RightPanel() {
  const send = useConnectionStore((s) => s.send)
  const toasts = useActivityStore((s) => s.toasts)
  const dismissToast = useActivityStore((s) => s.dismissToast)
  const clear = useActivityStore((s) => s.clear)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const rightPanelMode = useUiStore((s) => s.rightPanelMode)
  const setRightPanelMode = useUiStore((s) => s.setRightPanelMode)
  const claudeCode = usePermissionsStore((s) => s.claudeCode)
  const resolveClaudeCodeRequest = usePermissionsStore(
    (s) => s.resolveClaudeCodeRequest
  )
  const resolveCodexRequest = usePermissionsStore((s) => s.resolveCodexRequest)
  const pendingPermissionsRaw = usePermissionsStore((s) => s.pendingPermissionsRaw)
  const pendingQuestionsRaw = usePermissionsStore((s) => s.pendingQuestionsRaw)

  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const selectedSessionAgent = useSessionsStore((s) => s.selectedSessionAgent)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)

  // Read the raw maps from stores (stable references when unchanged)
  const todosBySession = useOpenCodeStore((s) => s.todosBySession)
  const commandsByProject = useOpenCodeStore((s) => s.commandsByProject)
  const agentsByProject = useOpenCodeStore((s) => s.agentsByProject)
  const codexApprovalsMap = usePermissionsStore((s) => s.codexApprovals)
  const codexUserInputsMap = usePermissionsStore((s) => s.codexUserInputs)

  // Derive values outside selectors so we don't create new refs inside getSnapshot
  const ocTodos = selectedSessionId ? todosBySession[selectedSessionId] : undefined
  const ocCommands = commandsByProject[""] ?? EMPTY
  const ocAgents = agentsByProject[""] ?? EMPTY

  const cxApprovals =
    selectedSessionAgent === "codex" && selectedSessionId
      ? codexApprovalsMap[selectedSessionId] ?? EMPTY
      : EMPTY
  const cxUserInputs =
    selectedSessionAgent === "codex" && selectedSessionId
      ? codexUserInputsMap[selectedSessionId] ?? EMPTY
      : EMPTY

  const permissionItems = React.useMemo(
    () => Object.values(claudeCode).flat(),
    [claudeCode]
  )

  const [commandToRun, setCommandToRun] = React.useState("")
  const [commandArgs, setCommandArgs] = React.useState("")
  const [ocAnswers, setOcAnswers] = React.useState<Record<string, string>>({})
  const [cxAnswers, setCxAnswers] = React.useState<
    Record<string, Record<string, { selected: string[]; other?: string }>>
  >({})
  const [openCodeModel, setOpenCodeModel] = React.useState("")
  const [claudeModel, setClaudeModel] = React.useState("")
  const [codexModel, setCodexModel] = React.useState("")

  const ocProviders = useConfigStore((s) => s.openCodeProviders)
  const ocConfig = useConfigStore((s) => s.openCodeConfig)
  const ccConfig = useConfigStore((s) => s.claudeCodeConfig)
  const ccSkills = useConfigStore((s) => s.claudeCodeSkills)
  const cxModels = useConfigStore((s) => s.codexModels)
  const cxConfig = useConfigStore((s) => s.codexConfig)
  const cxSkills = useConfigStore((s) => s.codexSkills)

  const claudeMcpFile = useMcpStore((s) => s.claudeMcpFile)
  const codexMcpStatus = useMcpStore((s) => s.codexMcpStatus)
  const [claudeMcpDraft, setClaudeMcpDraft] = React.useState("")

  React.useEffect(() => {
    if (claudeMcpFile?.content != null) setClaudeMcpDraft(claudeMcpFile.content)
  }, [claudeMcpFile?.content])

  const handleOcAnswerChange = React.useCallback((questionId: string, answer: string) => {
    setOcAnswers((s) => ({ ...s, [questionId]: answer }))
  }, [])

  const handleCxAnswerChange = React.useCallback((requestId: string, questionId: string, answer: { selected: string[]; other?: string }) => {
    setCxAnswers((s) => ({
      ...s,
      [requestId]: {
        ...(s[requestId] ?? {}),
        [questionId]: answer,
      },
    }))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <RightPanelHeader
        mode={rightPanelMode}
        onModeChange={setRightPanelMode}
        onClear={clear}
        onHide={toggleRightPanel}
      />

      <div className="flex-1 overflow-auto p-3">
        {rightPanelMode === "config" ? (
          <ConfigMode
            projectPath={selectedProjectPath}
            sessionAgent={selectedSessionAgent}
            sessionId={selectedSessionId}
            openCodeModel={openCodeModel}
            onOpenCodeModelChange={setOpenCodeModel}
            claudeModel={claudeModel}
            onClaudeModelChange={setClaudeModel}
            codexModel={codexModel}
            onCodexModelChange={setCodexModel}
            onSend={send}
            ocProviders={ocProviders}
            ocConfig={ocConfig}
            ccConfig={ccConfig}
            ccSkills={ccSkills}
            cxModels={cxModels}
            cxConfig={cxConfig}
            cxSkills={cxSkills}
            claudeMcpFile={claudeMcpFile}
            codexMcpStatus={codexMcpStatus}
            claudeMcpDraft={claudeMcpDraft}
            onClaudeMcpDraftChange={setClaudeMcpDraft}
          />
        ) : (
          <ActivityMode
            selectedSessionId={selectedSessionId}
            selectedSessionAgent={selectedSessionAgent}
            ocTodos={ocTodos ?? EMPTY}
            ocCommands={ocCommands}
            ocAgents={ocAgents}
            commandToRun={commandToRun}
            commandArgs={commandArgs}
            onCommandToRunChange={setCommandToRun}
            onCommandArgsChange={setCommandArgs}
            pendingPermissionsRaw={pendingPermissionsRaw}
            pendingQuestionsRaw={pendingQuestionsRaw}
            ocAnswers={ocAnswers}
            onOcAnswerChange={handleOcAnswerChange}
            cxApprovals={cxApprovals}
            cxUserInputs={cxUserInputs}
            cxAnswers={cxAnswers}
            onCxAnswerChange={handleCxAnswerChange}
            permissionItems={permissionItems}
            toasts={toasts}
            onDismissToast={dismissToast}
            onSend={send}
            onResolveCodexRequest={resolveCodexRequest}
            onResolveClaudeCodeRequest={resolveClaudeCodeRequest}
          />
        )}
      </div>
    </div>
  )
}