import type { ServerMessage } from "@/core/types"
import { useActivityStore } from "@/stores/activity-store"
import { useChatStore } from "@/stores/chat-store"
import { useConnectionStore } from "@/stores/connection-store"
import { useFilesStore } from "@/stores/files-store"
import { useGitStore } from "@/stores/git-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useTerminalStore } from "@/stores/terminal-store"
import { usePermissionsStore } from "@/stores/permissions-store"
import { useOpenCodeStore } from "@/stores/opencode-store"
import { useConfigStore } from "@/stores/config-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useMcpStore } from "@/stores/mcp-store"
import { useAutomationStore } from "@/stores/automation-store"
import { useIntegrationsStore } from "@/stores/integrations-store"

export function routeServerMessage(msg: ServerMessage) {
  switch (msg.type) {
    case "auth_session_ok": {
      useConnectionStore.getState().setCloudAuthOk(msg.data)
      return
    }
    case "status": {
      useConnectionStore.getState().setStatusPayload(msg.data)
      return
    }
    case "connection_metrics": {
      useConnectionStore.getState().setConnectionMetrics(msg.data)
      return
    }
    case "devices": {
      useConnectionStore.getState().setDevices(msg.data)
      return
    }
    case "device_connected": {
      useConnectionStore.getState().upsertDevice(msg.data)
      return
    }
    case "device_disconnected": {
      useConnectionStore.getState().removeDevice(msg.data.deviceId)
      return
    }
    case "projects": {
      useProjectsStore.getState().mergeProjects("opencode", msg.data)
      return
    }
    case "cc_projects": {
      useProjectsStore.getState().mergeProjects("claude-code", msg.data)
      return
    }
    case "cx_projects": {
      useProjectsStore.getState().mergeProjects("codex", msg.data)
      return
    }
    case "providers": {
      useConfigStore.getState().setOpenCodeProviders(msg.data)
      return
    }
    case "config": {
      useConfigStore.getState().setOpenCodeConfig(msg.data)
      return
    }
    case "sessions": {
      useSessionsStore.getState().setOpenCodeSessions(msg.projectPath, msg.data)
      return
    }
    case "session_created": {
      const projectPath =
        (msg.data as any)?.directory ?? (msg.data as any)?.projectPath ?? ""
      useSessionsStore.getState().upsertOpenCodeSession(projectPath, msg.data as any)
      const pending = useSessionsStore.getState().pendingCreate
      if (pending && pending.requestId === (msg as any).requestId && pending.agent === "opencode") {
        useSessionsStore.getState().setPendingCreate(null)
        useSessionsStore.getState().selectSession((msg.data as any).id, "opencode")
        useWorkspaceStore.getState().openChat("opencode", (msg.data as any).id)
      }
      return
    }
    case "session_messages": {
      useChatStore.getState().ingestOpenCodeSessionMessages(msg.sessionId, msg.data)
      return
    }
    case "cc_sessions": {
      useSessionsStore.getState().setClaudeCodeSessions(msg.data)
      return
    }
    case "cc_session_created": {
      useSessionsStore.getState().upsertClaudeCodeSession(msg.data as any)
      const pending = useSessionsStore.getState().pendingCreate
      if (pending && pending.requestId === (msg as any).requestId && pending.agent === "claude-code") {
        useSessionsStore.getState().setPendingCreate(null)
        useSessionsStore.getState().selectSession((msg.data as any).id, "claude-code")
        useWorkspaceStore.getState().openChat("claude-code", (msg.data as any).id)
      }
      return
    }
    case "cc_session_messages": {
      useChatStore
        .getState()
        .ingestClaudeCodeTranscriptMessages(msg.sessionId, msg.data)
      return
    }
    case "cx_threads": {
      useSessionsStore.getState().setCodexThreads(msg.data, msg.nextCursor ?? null)
      return
    }
    case "cx_thread_created":
    case "cx_thread": {
      useSessionsStore.getState().upsertCodexThread(msg.data as any)
      const pending = useSessionsStore.getState().pendingCreate
      if (pending && pending.requestId === (msg as any).requestId && pending.agent === "codex") {
        useSessionsStore.getState().setPendingCreate(null)
        useSessionsStore.getState().selectSession((msg.data as any).id, "codex")
        useWorkspaceStore.getState().openChat("codex", (msg.data as any).id)
      }
      return
    }
    case "cx_thread_messages": {
      useChatStore.getState().ingestCodexThreadMessages(msg.threadId, msg.data)
      return
    }
    case "cc_stream": {
      useChatStore.getState().ingestClaudeCodeStream(msg.sessionId, msg.data)
      return
    }
    case "cc_config": {
      useConfigStore.getState().setClaudeCodeConfig(msg.data)
      return
    }
    case "cc_skills": {
      useConfigStore.getState().setClaudeCodeSkills(msg.data)
      return
    }
    case "cc_skill": {
      useAutomationStore.getState().setCcSkill(msg.data as any)
      return
    }
    case "cc_skill_saved": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "Claude skill saved",
      })
      return
    }
    case "cc_skill_deleted": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "Claude skill deleted",
      })
      return
    }
    case "cc_commands": {
      if (Array.isArray(msg.data)) useAutomationStore.getState().setCcCommands(msg.data as any)
      return
    }
    case "cc_command_file": {
      useAutomationStore.getState().setCcCommand({
        name: (msg.data as any)?.name ?? "",
        path: (msg.data as any)?.path ?? "",
        source: (msg.data as any)?.source,
        content: (msg.data as any)?.content ?? "",
      })
      return
    }
    case "cc_command_saved": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "Claude command saved",
      })
      return
    }
    case "cc_command_deleted": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "Claude command deleted",
      })
      return
    }
    case "cc_hooks_file": {
      useAutomationStore.getState().setCcHooksFile(msg.data as any)
      return
    }
    case "cc_hooks_file_written": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "Hooks file saved",
      })
      return
    }
    case "cc_mcp_file": {
      useMcpStore.getState().setClaudeMcpFile(msg.data as any)
      return
    }
    case "cc_mcp_file_written": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "MCP file saved",
      })
      return
    }
    case "cx_stream": {
      // Keep transcript in sync without having to fully parse every stream method.
      if (
        msg.data?.type === "notification" &&
        (msg.data as any).method === "turn/completed"
      ) {
        useConnectionStore
          .getState()
          .send({ type: "cx_get_thread_messages", threadId: msg.threadId } as any)
      }
      useChatStore.getState().ingestCodexStream(msg.threadId, msg.data)
      return
    }
    case "cx_models": {
      useConfigStore.getState().setCodexModels(msg.data)
      return
    }
    case "cx_config": {
      useConfigStore.getState().setCodexConfig(msg.data)
      return
    }
    case "cx_skills": {
      useConfigStore.getState().setCodexSkills(msg.data)
      return
    }
    case "cx_skill": {
      useAutomationStore.getState().setCxSkill(msg.data as any)
      return
    }
    case "cx_skill_saved": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "Codex skill saved",
      })
      return
    }
    case "cx_skill_deleted": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "Codex skill deleted",
      })
      return
    }
    case "cx_mcp_status": {
      useMcpStore.getState().setCodexMcpStatus(msg.data)
      return
    }
    case "cx_mcp_reloaded": {
      useActivityStore.getState().pushToast({
        kind: "success",
        title: "MCP reloaded",
      })
      useMcpStore.getState().setCodexMcpStatus(msg.data)
      return
    }
    case "sdk_event": {
      useChatStore.getState().ingestOpenCodeEvent(msg.data)
      return
    }
    case "sdk_event_batch": {
      useChatStore.getState().ingestOpenCodeEventBatch(msg.data)
      return
    }
    case "browse_result": {
      useFilesStore.getState().setBrowseResult(msg.data.path, msg.data.items)
      return
    }
    case "file_content": {
      useFilesStore.getState().setFileContent(msg.path, msg.data)
      return
    }
    case "vcs": {
      useGitStore.getState().setVcs(msg.data)
      return
    }
    case "file_status": {
      useGitStore.getState().setFileStatus(msg.data)
      return
    }
    case "worktrees": {
      useGitStore.getState().setWorktrees(msg.data as any)
      return
    }
    case "worktree_created": {
      useGitStore.getState().setWorktrees([
        msg.data as any,
        ...useGitStore.getState().worktrees.filter((w) => (w as any).name !== (msg.data as any).name),
      ] as any)
      return
    }
    case "worktree_deleted": {
      useGitStore.getState().setWorktrees(
        useGitStore.getState().worktrees.filter((w) => (w as any).name !== (msg as any).name)
      )
      return
    }
    case "git_diff": {
      const p = (msg.data as any)?.path ?? null
      const diff = (msg.data as any)?.diff ?? ""
      const staged = (msg.data as any)?.staged
      useGitStore.getState().setGitDiff(p, diff, staged)
      return
    }
    case "mcp_status": {
      useIntegrationsStore.getState().setOcMcpStatus(msg.data as any)
      return
    }
    case "mcp_connected": {
      useActivityStore.getState().pushToast({
        kind: msg.data ? "success" : "error",
        title: `MCP connected: ${(msg as any).name ?? ""}`.trim(),
      })
      return
    }
    case "mcp_disconnected": {
      useActivityStore.getState().pushToast({
        kind: msg.data ? "success" : "error",
        title: `MCP disconnected: ${(msg as any).name ?? ""}`.trim(),
      })
      return
    }
    case "mcp_resources": {
      useIntegrationsStore.getState().setOcMcpResources(msg.data as any)
      return
    }
    case "all_providers": {
      useIntegrationsStore.getState().setOcAllProviders(msg.data as any)
      return
    }
    case "provider_auth": {
      useIntegrationsStore.getState().setOcProviderAuth(msg.data as any)
      return
    }
    case "tool_ids": {
      useIntegrationsStore.getState().setOcToolIds(Array.isArray(msg.data) ? (msg.data as any) : [])
      return
    }
    case "tools": {
      useIntegrationsStore.getState().setOcTools(Array.isArray(msg.data) ? (msg.data as any) : [])
      return
    }
    case "pending_permissions": {
      usePermissionsStore.getState().setPendingPermissions(msg.data)
      return
    }
    case "pending_questions": {
      usePermissionsStore.getState().setPendingQuestions(msg.data)
      return
    }
    case "oc_question_replied": {
      useActivityStore.getState().pushToast({
        kind: msg.data ? "success" : "error",
        title: "Question replied",
      })
      // Refresh list after replies
      useConnectionStore.getState().send({ type: "list_pending_questions" } as any)
      return
    }
    case "oc_question_rejected": {
      useActivityStore.getState().pushToast({
        kind: msg.data ? "success" : "error",
        title: "Question rejected",
      })
      useConnectionStore.getState().send({ type: "list_pending_questions" } as any)
      return
    }
    case "todos": {
      useOpenCodeStore.getState().setTodos(msg.sessionId, msg.data)
      return
    }
    case "oc_skills": {
      useAutomationStore.getState().setOcSkills(msg.data as any)
      return
    }
    case "oc_skill": {
      useAutomationStore.getState().setOcSkill(msg.data as any)
      return
    }
    case "oc_skill_saved": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode skill saved",
      })
      return
    }
    case "oc_skill_deleted": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode skill deleted",
      })
      return
    }
    case "oc_command_files": {
      useAutomationStore.getState().setOcCommandFiles(msg.data as any)
      return
    }
    case "oc_command_file": {
      useAutomationStore.getState().setOcCommandFile(msg.data as any)
      return
    }
    case "oc_command_file_saved": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode command file saved",
      })
      return
    }
    case "oc_command_file_deleted": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode command file deleted",
      })
      return
    }
    case "oc_agent_files": {
      useAutomationStore.getState().setOcAgentFiles(msg.data as any)
      return
    }
    case "oc_agent_file": {
      useAutomationStore.getState().setOcAgentFile(msg.data as any)
      return
    }
    case "oc_agent_file_saved": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode agent file saved",
      })
      return
    }
    case "oc_agent_file_deleted": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode agent file deleted",
      })
      return
    }
    case "oc_plugin_files": {
      useAutomationStore.getState().setOcPluginFiles(msg.data as any)
      return
    }
    case "oc_plugin_file": {
      useAutomationStore.getState().setOcPluginFile(msg.data as any)
      return
    }
    case "oc_plugin_file_saved": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode plugin file saved",
      })
      return
    }
    case "oc_plugin_file_deleted": {
      useActivityStore.getState().pushToast({
        kind: (msg.data as any)?.ok ? "success" : "error",
        title: "OpenCode plugin file deleted",
      })
      return
    }
    case "commands": {
      useOpenCodeStore.getState().setCommands(null, msg.data)
      return
    }
    case "command_executed": {
      useActivityStore.getState().pushToast({
        kind: "info",
        title: "Command executed",
        message: `sessionId: ${msg.sessionId}`,
      })
      return
    }
    case "agents": {
      useOpenCodeStore.getState().setAgents(null, msg.data)
      return
    }
    case "lsp_status": {
      useOpenCodeStore.getState().setLsp(null, msg.data)
      return
    }
    case "session_context": {
      useOpenCodeStore.getState().setContext(msg.sessionId, msg.data)
      return
    }
    case "pty_list": {
      useTerminalStore.getState().setPtys(msg.data)
      return
    }
    case "pty_created": {
      useTerminalStore.getState().upsertPty(msg.data)
      useTerminalStore.getState().setActivePtyId(msg.data.id)
      return
    }
    case "pty_updated":
    case "pty": {
      useTerminalStore.getState().upsertPty(msg.data)
      return
    }
    case "pty_deleted": {
      useTerminalStore.getState().removePty(msg.ptyId)
      return
    }
    case "pty_output": {
      useTerminalStore.getState().appendOutput(msg.ptyId, msg.data)
      return
    }
    case "pty_error": {
      useTerminalStore.getState().setPtyError(msg.ptyId, msg.error)
      return
    }
    case "pty_exit": {
      useTerminalStore.getState().markExited(msg.ptyId, msg.exitCode)
      return
    }
    case "error": {
      useActivityStore.getState().pushToast({
        kind: "error",
        title: "Bridge error",
        message: msg.message,
      })
      return
    }
    default:
      return
  }
}
