import * as React from "react"

import { useActivityStore } from "@/stores/activity-store"
import { useConnectionStore } from "@/stores/connection-store"
import { usePermissionsStore } from "@/stores/permissions-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useOpenCodeStore } from "@/stores/opencode-store"
import { useUiStore } from "@/stores/ui-store"
import { useConfigStore } from "@/stores/config-store"
import { useProjectsStore } from "@/stores/projects-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-sm font-semibold">
          {rightPanelMode === "config" ? "Config" : "Activity"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={rightPanelMode === "activity" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setRightPanelMode("activity")}
          >
            Activity
          </Button>
          <Button
            variant={rightPanelMode === "config" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setRightPanelMode("config")}
          >
            Config
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleRightPanel}>
            Hide
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {rightPanelMode === "config" ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
              <div className="text-xs font-semibold text-muted-foreground">
                Context
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                project: {selectedProjectPath ?? "(none)"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                session: {selectedSessionAgent ?? "(none)"} ·{" "}
                {selectedSessionId ?? "(none)"}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
              <div className="text-xs font-semibold text-muted-foreground">
                OpenCode
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => send({ type: "list_providers" } as any)}
                >
                  Providers
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    send({ type: "get_config", projectPath: selectedProjectPath ?? undefined } as any)
                  }
                >
                  Config
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    send({ type: "list_commands", projectPath: selectedProjectPath ?? undefined } as any)
                  }
                >
                  Commands
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    send({ type: "list_agents", projectPath: selectedProjectPath ?? undefined } as any)
                  }
                >
                  Agents
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={openCodeModel}
                  onChange={(e) => setOpenCodeModel(e.target.value)}
                  placeholder="model (providerID:modelID)"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const m = openCodeModel.trim()
                    if (!m) return
                    send({ type: "set_model", model: m, projectPath: selectedProjectPath ?? undefined } as any)
                  }}
                >
                  Set
                </Button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Providers payload
                </summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                  {JSON.stringify(ocProviders, null, 2)}
                </pre>
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Config payload
                </summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                  {JSON.stringify(ocConfig, null, 2)}
                </pre>
              </details>
            </div>

            <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
              <div className="text-xs font-semibold text-muted-foreground">
                Claude Code
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    send({ type: "cc_get_config", cwd: selectedProjectPath ?? undefined } as any)
                  }
                >
                  Config
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    send({ type: "cc_list_skills", cwd: selectedProjectPath ?? undefined } as any)
                  }
                >
                  Skills
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                  placeholder="model (e.g. claude-sonnet)"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const m = claudeModel.trim()
                    if (!m) return
                    send({ type: "cc_set_config", cwd: selectedProjectPath ?? undefined, config: { model: m } } as any)
                  }}
                >
                  Set
                </Button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Config payload
                </summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                  {JSON.stringify(ccConfig, null, 2)}
                </pre>
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Skills payload
                </summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                  {JSON.stringify(ccSkills, null, 2)}
                </pre>
              </details>
            </div>

            <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
              <div className="text-xs font-semibold text-muted-foreground">
                Codex
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => send({ type: "cx_model_list" } as any)}
                >
                  Models
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => send({ type: "cx_config_read" } as any)}
                >
                  Config
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    send({ type: "cx_skills_list", cwd: selectedProjectPath ?? undefined } as any)
                  }
                >
                  Skills
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={codexModel}
                  onChange={(e) => setCodexModel(e.target.value)}
                  placeholder="model (e.g. gpt-4.1)"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const m = codexModel.trim()
                    if (!m || !selectedProjectPath) return
                    // Start a thread with an explicit model (Codex creates threads on chat, but
                    // `cx_start_thread` gives explicit control).
                    send({ type: "cx_start_thread", cwd: selectedProjectPath, model: m } as any)
                  }}
                >
                  Start
                </Button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Models payload
                </summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                  {JSON.stringify(cxModels, null, 2)}
                </pre>
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Config payload
                </summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                  {JSON.stringify(cxConfig, null, 2)}
                </pre>
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Skills payload
                </summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                  {JSON.stringify(cxSkills, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        ) : null}

        {rightPanelMode === "activity" ? (
          <>
        {selectedSessionAgent === "opencode" && selectedSessionId ? (
          <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              OpenCode · Session Tools
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  send({ type: "get_todos", sessionId: selectedSessionId } as any)
                }
              >
                Todos
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => send({ type: "list_commands" } as any)}
              >
                Commands
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => send({ type: "list_agents" } as any)}
              >
                Agents
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => send({ type: "get_lsp_status" } as any)}
              >
                LSP
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  send({ type: "get_session_context", sessionId: selectedSessionId } as any)
                }
              >
                Context
              </Button>
            </div>

            {ocTodos && ocTodos.length > 0 ? (
              <div className="mt-3 space-y-2">
                {ocTodos.slice(0, 20).map((t) => (
                  <div
                    key={t.id}
                    className="rounded-md border border-border bg-card p-2"
                  >
                    <div className="text-xs font-semibold">{t.content}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t.status} · {t.priority}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {ocCommands.length > 0 ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-muted-foreground">
                  Slash Commands
                </div>
                <div className="mt-2 space-y-1">
                  {ocCommands.slice(0, 12).map((c) => (
                    <button
                      key={c.name}
                      className="w-full rounded-md border border-border bg-card px-2 py-2 text-left text-xs hover:bg-accent/20"
                      onClick={() => setCommandToRun(c.name)}
                    >
                      <div className="font-semibold">/{c.name}</div>
                      {c.description ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {c.description}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    value={commandToRun}
                    onChange={(e) => setCommandToRun(e.target.value)}
                    placeholder="command"
                  />
                  <Input
                    value={commandArgs}
                    onChange={(e) => setCommandArgs(e.target.value)}
                    placeholder="args"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!commandToRun.trim()) return
                      send({
                        type: "execute_command",
                        sessionId: selectedSessionId,
                        command: commandToRun.trim(),
                        arguments: commandArgs,
                      } as any)
                    }}
                  >
                    Run
                  </Button>
                </div>
              </div>
            ) : null}

            {ocAgents.length > 0 ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-muted-foreground">
                  Agents
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ocAgents.slice(0, 12).map((a) => (
                    <div
                      key={a.name}
                      className="rounded-md border border-border bg-card px-2 py-1 text-[11px]"
                    >
                      {a.name}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {pendingPermissionsRaw.length > 0 ? (
          <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Pending Permissions ({pendingPermissionsRaw.length})
            </div>
            <div className="mt-3 space-y-2">
              {pendingPermissionsRaw.slice(0, 10).map((p: any, idx: number) => {
                const requestId =
                  (typeof p?.requestID === "string" && p.requestID) ||
                  (typeof p?.requestId === "string" && p.requestId) ||
                  (typeof p?.id === "string" && p.id) ||
                  ""
                return (
                  <div
                    key={`${requestId || "perm"}:${idx}`}
                    className="rounded-md border border-border bg-card p-2"
                  >
                    <div className="text-xs font-semibold">
                      {p?.permission ?? p?.tool ?? "permission"}
                    </div>
                    {requestId ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        id: {requestId}
                      </div>
                    ) : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        Details
                      </summary>
                      <pre className="mt-2 max-h-[180px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                        {JSON.stringify(p, null, 2)}
                      </pre>
                    </details>
                    {selectedSessionAgent === "opencode" &&
                    selectedSessionId &&
                    requestId ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            send({
                              type: "permission_response",
                              sessionId: selectedSessionId,
                              permissionId: requestId,
                              response: "once",
                            } as any)
                          }
                        >
                          Allow Once
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            send({
                              type: "permission_response",
                              sessionId: selectedSessionId,
                              permissionId: requestId,
                              response: "always",
                            } as any)
                          }
                        >
                          Always
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            send({
                              type: "permission_response",
                              sessionId: selectedSessionId,
                              permissionId: requestId,
                              response: "reject",
                            } as any)
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {selectedSessionAgent === "codex" && selectedSessionId ? (
          <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Codex · Requests
            </div>

            {cxApprovals.length > 0 ? (
              <div className="mt-3 space-y-2">
                {cxApprovals.slice(0, 10).map((r) => (
                  <div
                    key={r.requestId}
                    className="rounded-md border border-border bg-card p-2"
                  >
                    <div className="text-xs font-semibold">Approval</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.method}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      requestId: {r.requestId}
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        Details
                      </summary>
                      <pre className="mt-2 max-h-[180px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                        {JSON.stringify(r.params, null, 2)}
                      </pre>
                    </details>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          send({
                            type: "cx_permission_response",
                            requestId: r.requestId,
                            response: "once",
                          } as any)
                          resolveCodexRequest(selectedSessionId, r.requestId)
                        }}
                      >
                        Allow Once
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          send({
                            type: "cx_permission_response",
                            requestId: r.requestId,
                            response: "always",
                          } as any)
                          resolveCodexRequest(selectedSessionId, r.requestId)
                        }}
                      >
                        Always
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          send({
                            type: "cx_permission_response",
                            requestId: r.requestId,
                            response: "reject",
                          } as any)
                          resolveCodexRequest(selectedSessionId, r.requestId)
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {cxUserInputs.length > 0 ? (
              <div className="mt-3 space-y-2">
                {cxUserInputs.slice(0, 5).map((r) => (
                  <div
                    key={r.requestId}
                    className="rounded-md border border-border bg-card p-2"
                  >
                    <div className="text-xs font-semibold">User Input</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      requestId: {r.requestId}
                    </div>

                    <div className="mt-2 space-y-2">
                      {r.questions.map((q) => {
                        const draft = cxAnswers[r.requestId]?.[q.id] ?? {
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
                                          setCxAnswers((s) => ({
                                            ...s,
                                            [r.requestId]: {
                                              ...(s[r.requestId] ?? {}),
                                              [q.id]: {
                                                selected: nextSelected,
                                                other: draft.other,
                                              },
                                            },
                                          }))
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
                                  setCxAnswers((s) => ({
                                    ...s,
                                    [r.requestId]: {
                                      ...(s[r.requestId] ?? {}),
                                      [q.id]: {
                                        selected: draft.selected,
                                        other,
                                      },
                                    },
                                  }))
                                }}
                                placeholder="Other (optional)"
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const answersForReq = cxAnswers[r.requestId] ?? {}
                          send({
                            type: "cx_user_input_response",
                            requestId: r.requestId,
                            answers: answersForReq,
                          } as any)
                          resolveCodexRequest(selectedSessionId, r.requestId)
                        }}
                      >
                        Submit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveCodexRequest(selectedSessionId, r.requestId)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {cxApprovals.length === 0 && cxUserInputs.length === 0 ? (
              <div className="mt-3 text-xs text-muted-foreground">
                No pending Codex requests.
              </div>
            ) : null}
          </div>
        ) : null}

        {pendingQuestionsRaw.length > 0 ? (
          <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Pending Questions ({pendingQuestionsRaw.length})
            </div>
            <div className="mt-3 space-y-2">
              {pendingQuestionsRaw.slice(0, 5).map((q: any, idx: number) => {
                const questionId =
                  (typeof q?.id === "string" && q.id) ||
                  (typeof q?.questionId === "string" && q.questionId) ||
                  (typeof q?.questionID === "string" && q.questionID) ||
                  ""
                const prompt = q?.prompt ?? q?.question ?? "question"
                const current = questionId ? ocAnswers[questionId] ?? "" : ""
                const optionsRaw =
                  Array.isArray(q?.options)
                    ? q.options
                    : Array.isArray(q?.choices)
                      ? q.choices
                      : []
                const options = optionsRaw
                  .map((o: any) =>
                    typeof o === "string"
                      ? { label: o }
                      : typeof o?.label === "string"
                        ? { label: o.label }
                        : null
                  )
                  .filter(Boolean) as Array<{ label: string }>

                return (
                  <div
                    key={`${questionId || "q"}:${idx}`}
                    className="rounded-md border border-border bg-card p-2"
                  >
                    <div className="text-xs font-semibold">{String(prompt)}</div>
                    {questionId ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        id: {questionId}
                      </div>
                    ) : null}

                    {options.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {options.slice(0, 8).map((o) => (
                          <Button
                            key={o.label}
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!questionId) return
                              setOcAnswers((s) => ({ ...s, [questionId]: o.label }))
                            }}
                          >
                            {o.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}

                    {questionId ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          value={current}
                          onChange={(e) =>
                            setOcAnswers((s) => ({
                              ...s,
                              [questionId]: e.target.value,
                            }))
                          }
                          placeholder="Answer…"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            const answer = (ocAnswers[questionId] ?? "").trim()
                            if (!answer) return
                            send({
                              type: "oc_question_reply",
                              questionId,
                              answers: [[answer]],
                            } as any)
                          }}
                        >
                          Reply
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            send({ type: "oc_question_reject", questionId } as any)
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-muted-foreground">
                          Details
                        </summary>
                        <pre className="mt-2 max-h-[240px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                          {JSON.stringify(q, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {permissionItems.length > 0 ? (
          <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Needs Attention ({permissionItems.length})
            </div>
            <div className="mt-3 space-y-2">
              {permissionItems.slice(0, 20).map((p) => (
                <div
                  key={`${p.sessionId}:${p.toolUseId}`}
                  className="rounded-md border border-border bg-card p-3"
                >
                  <div className="text-sm font-semibold">{p.tool}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Session: {p.sessionId}
                  </div>
                  {p.decisionReason ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {p.decisionReason}
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        send({
                          type: "cc_permission_response",
                          sessionId: p.sessionId,
                          toolUseId: p.toolUseId,
                          response: "once",
                        } as any)
                        resolveClaudeCodeRequest(p.sessionId, p.toolUseId)
                      }}
                    >
                      Allow Once
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        send({
                          type: "cc_permission_response",
                          sessionId: p.sessionId,
                          toolUseId: p.toolUseId,
                          response: "always",
                        } as any)
                        resolveClaudeCodeRequest(p.sessionId, p.toolUseId)
                      }}
                    >
                      Always
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        send({
                          type: "cc_permission_response",
                          sessionId: p.sessionId,
                          toolUseId: p.toolUseId,
                          response: "reject",
                        } as any)
                        resolveClaudeCodeRequest(p.sessionId, p.toolUseId)
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {toasts.length === 0 ? (
          <div className="rounded-lg border border-border bg-[var(--panel)] p-4 text-sm text-muted-foreground">
            No activity yet.
          </div>
        ) : (
          <div className="space-y-2">
            {toasts.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-border bg-[var(--panel)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {t.title}
                    </div>
                    {t.message ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t.message}
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {new Date(t.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissToast(t.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
          </>
        ) : null}
      </div>
    </div>
  )
}
