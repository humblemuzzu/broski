// ============================================================================
// CODEX (OpenAI Codex app-server) TYPES
// ============================================================================

export type CodexPrompt = {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
  path: string;
  source: "project" | "user";
};

export type CodexThread = {
  id: string;
  preview: string;
  modelProvider?: string;
  createdAt: number; // Unix timestamp seconds
  updatedAt: number; // Unix timestamp seconds (SDK v0.87.0+)
  cwd: string;
  cliVersion?: string;
  source?: string;
  gitInfo?: { branch?: string } | null;
  status?: { type: string; activeFlags?: string[] };
  agentNickname?: string | null;
  agentRole?: string | null;
};

export type CodexTranscriptToolCall = {
  itemId: string;
  type:
    | "commandExecution"
    | "fileChange"
    | "mcpToolCall"
    | "webSearch"
    | "imageView"
    | "review";
  name: string;
  status: "running" | "completed" | "failed" | "declined";
  input?: any;
  output?: string;
  metadata?: Record<string, unknown>;
};

export type CodexTranscriptDiff = {
  file: string;
  diff: string;
  additions: number;
  deletions: number;
  itemId?: string;
};

export type CodexTranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: number;
  text: string;
  thinking?: string;
  toolCalls?: CodexTranscriptToolCall[];
  diffs?: CodexTranscriptDiff[];
};

export type CodexStreamMessage =
  | { type: "notification"; method: string; params: any }
  | { type: "request"; requestId: string; method: string; params: any }
  | {
      type: "error";
      message: string;
      code?: string;
      details?: any;
      modelCapModel?: string;
      modelCapRetrySeconds?: number;
    }
  | { type: "collab_spawn_begin"; data: CodexCollabAgentSpawnBeginEvent }
  | { type: "collab_spawn_end"; data: CodexCollabAgentSpawnEndEvent }
  | {
      type: "collab_interaction_begin";
      data: CodexCollabAgentInteractionBeginEvent;
    }
  | {
      type: "collab_interaction_end";
      data: CodexCollabAgentInteractionEndEvent;
    }
  | { type: "collab_waiting_begin"; data: CodexCollabWaitingBeginEvent }
  | { type: "collab_waiting_end"; data: CodexCollabWaitingEndEvent }
  | { type: "collab_close_begin"; data: CodexCollabCloseBeginEvent }
  | { type: "collab_close_end"; data: CodexCollabCloseEndEvent }
  | { type: "collab_resume_begin"; data: CodexCollabResumeBeginEvent }
  | { type: "collab_resume_end"; data: CodexCollabResumeEndEvent };

// ============================================================================
// CODEX MULTI-AGENT COLLABORATION TYPES (SDK v0.87.0+)
// ============================================================================

export type CodexAgentStatus =
  | { type: "pending_init" }
  | { type: "running" }
  | { type: "completed"; message?: string }
  | { type: "errored"; error: string }
  | { type: "shutdown" }
  | { type: "not_found" };

export type CodexCollabAgentSpawnBeginEvent = {
  callId: string;
  senderThreadId: string;
  prompt: string;
};

export type CodexCollabAgentSpawnEndEvent = {
  callId: string;
  senderThreadId: string;
  newThreadId?: string;
  newAgentNickname?: string | null;
  newAgentRole?: string | null;
  prompt: string;
  status: CodexAgentStatus;
};

export type CodexCollabAgentInteractionBeginEvent = {
  callId: string;
  senderThreadId: string;
  receiverThreadId: string;
  prompt: string;
};

export type CodexCollabAgentInteractionEndEvent = {
  callId: string;
  senderThreadId: string;
  receiverThreadId: string;
  prompt: string;
  status: CodexAgentStatus;
};

export type CodexCollabWaitingBeginEvent = {
  senderThreadId: string;
  receiverThreadIds: string[];
  callId: string;
};

export type CodexCollabWaitingEndEvent = {
  senderThreadId: string;
  callId: string;
  statuses: Record<string, CodexAgentStatus>;
};

export type CodexCollabCloseBeginEvent = {
  callId: string;
  senderThreadId: string;
  receiverThreadId: string;
};

export type CodexCollabCloseEndEvent = {
  callId: string;
  senderThreadId: string;
  receiverThreadId: string;
  status: CodexAgentStatus;
};

export type CodexCollabResumeBeginEvent = {
  callId: string;
  senderThreadId: string;
  receiverThreadId: string;
};

export type CodexCollabResumeEndEvent = {
  callId: string;
  senderThreadId: string;
  receiverThreadId: string;
  status: CodexAgentStatus;
};

export type CodexWebSearchMode = "disabled" | "cached" | "live";

// ============================================================================
// CODEX NEW SDK TYPES (mid-2026)
// ============================================================================

export type CodexRemoteSkill = {
  id: string;
  name: string;
  description: string;
};

export type CodexAppInfo = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  logoUrlDark: string | null;
  distributionChannel: string | null;
  branding?: Record<string, unknown> | null;
  appMetadata?: Record<string, unknown> | null;
  labels?: Record<string, string> | null;
  installUrl: string | null;
  isAccessible: boolean;
  isEnabled: boolean;
};

export type CodexPersonality = "none" | "friendly" | "pragmatic";

export type CodexModeKind = "plan" | "default";
