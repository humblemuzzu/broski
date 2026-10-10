import type { ClientMessage } from "./client";
import type { AgentType } from "./common";

export type CoreClientMessage =
	| {
			type: "batch";
			messages: Array<ClientMessage & { requestId?: string }>;
			count?: number;
			timestamp?: number;
	  }
	| {
			type: "set_view";
			projectPath?: string;
			sessionId?: string;
			agent?: AgentType;
			lastRuntimeSeq?: number;
	  }
	| { type: "set_agent"; agent: AgentType }
	| { type: "restart_opencode" }
	| { type: "pong"; id: string; sentAt: number }
	// Client-initiated ping (for app lifecycle detection)
	| { type: "client_ping"; id: string; sentAt: number }
	// Multi-device support
	| {
			type: "register_device";
			deviceId: string;
			deviceName: string;
			platform: string;
			protocolVersion?: string;
	  }
	| { type: "list_devices" }
	| { type: "disconnect_device"; deviceId: string }
	| { type: "list_projects" };
