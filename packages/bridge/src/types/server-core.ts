import type { DeviceInfo, StatusPayload } from "./common";
import type { LspServerStatus, ProjectSummary, SessionContextInfo, SessionSummary } from "./session";

export type CoreServerMessage =
	| { type: "projects"; data: ProjectSummary[]; requestId?: string }
	| {
			type: "sessions";
			data: SessionSummary[];
			projectPath?: string;
			requestId?: string;
	  }
	| { type: "providers"; data: unknown; requestId?: string }
	| { type: "config"; data: unknown; requestId?: string }
	| { type: "session"; data: SessionSummary; requestId?: string }
	| {
			type: "session_messages";
			data: unknown;
			sessionId: string;
			requestId?: string;
	  }
	| { type: "session_created"; data: SessionSummary; requestId?: string }
	| { type: "diff"; data: unknown; sessionId: string; requestId?: string }
	| {
			type: "browse_result";
			data: { path: string; items: unknown[] };
			requestId?: string;
	  }
	| { type: "batch"; messages: unknown[]; count: number; timestamp: number }
	| { type: "ping"; data: { id: string; sentAt: number } }
	| { type: "client_pong"; id: string; sentAt: number; receivedAt: number }
	| {
			type: "connection_metrics";
			data: { rttMs: number; lastPongAt: number; connectionType?: string };
	  }
	| { type: "opencode_restarted"; data: boolean; requestId?: string }
	| { type: "status"; data: StatusPayload }
	| { type: "error"; message: string; code?: string; requestId?: string }
	| { type: "lsp_status"; data: LspServerStatus[]; requestId?: string }
	| {
			type: "session_context";
			data: SessionContextInfo;
			sessionId: string;
			requestId?: string;
	  }
	| {
			type: "device_registered";
			data: DeviceInfo;
			protocolVersion?: string;
			requestId?: string;
	  }
	| { type: "devices"; data: DeviceInfo[]; requestId?: string }
	| {
			type: "device_disconnected";
			data: { deviceId: string; deviceName?: string };
			requestId?: string;
	  }
	| { type: "device_connected"; data: DeviceInfo }
	| { type: "pending_permissions"; data: unknown[]; requestId?: string }
	| { type: "pending_questions"; data: unknown[]; requestId?: string }
	// Active sessions snapshot (sent on connect)
	| {
			type: "sessions_active";
			data: {
				claudeCode: Array<{ sessionId: string; cwd?: string; startedAt?: number }>;
				codex: Array<{ threadId: string; turnId?: string; cwd?: string }>;
				opencode: Array<{ sessionId: string; projectPath?: string; statusType: "busy" | "retry" }>;
				pi: unknown[];
				pendingPermissions: {
					claudeCode: Array<{ sessionId: string; toolUseId: string }>;
					claudeCodeElicitations: Array<{ sessionId: string; requestId: string }>;
					codex: string[];
				};
			};
	  }
	// Network endpoint live updates (bridge re-discovers IPs periodically)
	| {
			type: "network_endpoints_updated";
			data: { localIP: string | null; tailscaleIP: string | null; hotspotIP: string | null; port: number };
	  };
