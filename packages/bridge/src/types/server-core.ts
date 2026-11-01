import type { DeviceInfo, StatusPayload } from "./common";

export type CoreServerMessage =
	| { type: "batch"; messages: unknown[]; count: number; timestamp: number }
	| { type: "ping"; data: { id: string; sentAt: number } }
	| { type: "client_pong"; id: string; sentAt: number; receivedAt: number }
	| {
			type: "connection_metrics";
			data: { rttMs: number; lastPongAt: number };
	  }
	| { type: "status"; data: StatusPayload }
	| { type: "error"; message: string; code?: string; requestId?: string }
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
	// Active sessions snapshot (sent on connect)
	| {
			type: "sessions_active";
			data: {
				claudeCode: Array<{ sessionId: string; cwd?: string; startedAt?: number }>;
				pendingPermissions: {
					claudeCode: Array<{ sessionId: string; toolUseId: string }>;
					claudeCodeElicitations: Array<{ sessionId: string; requestId: string }>;
				};
			};
	  };
