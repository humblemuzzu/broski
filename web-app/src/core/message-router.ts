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
    case "projects":
    case "cc_projects":
    case "cx_projects": {
      useProjectsStore.getState().setProjects(msg.data)
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
    case "session_messages": {
      useChatStore.getState().ingestOpenCodeSessionMessages(msg.sessionId, msg.data)
      return
    }
    case "cc_sessions": {
      useSessionsStore.getState().setClaudeCodeSessions(msg.data)
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
