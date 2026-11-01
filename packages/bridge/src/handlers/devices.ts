import type { ServerWebSocket } from "bun";
import { registerAll } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import { pendingElicitations } from "../server/pending-elicitation";
import type { AgentType, DeviceInfo, ServerMessage } from "../types";
import type { ClaudeElicitationReply } from "./cc_elicitation";

type ReplyFn = (msg: ServerMessage) => void;

const DEVICE_OPS = ["register_device", "list_devices", "disconnect_device"] as const;

export const MODULE_TYPES = DEVICE_OPS;

export function register(router: MessageRouter, deps: ServerDeps): void {
	const ctx: DevicesHandlerContext = {
		sockets: deps.sockets,
		contexts: deps.contexts,
		ALLOWED_DEVICE_IDS: deps.ALLOWED_DEVICE_IDS,
		BRIDGE_PROTOCOL_VERSION: deps.BRIDGE_PROTOCOL_VERSION,
		getDeviceInfo: deps.getDeviceInfo,
		getAllDevices: deps.getAllDevices,
		findSocketByDeviceId: deps.findSocketByDeviceId,
		send: deps.send,
		broadcast: deps.broadcast,
		sendStatus: deps.sendStatus,
		logUser: deps.logUser,
		logError: deps.logError,
		safeString: deps.safeString,
		claudeCode: deps.claudeCode,
		ccPermissionWaiters: deps.ccPermissionWaiters,
		ccElicitationWaiters: deps.ccElicitationWaiters,
		buildClaudeCodeRuntimeState: deps.buildClaudeCodeRuntimeState,
	};
	registerAll(router, DEVICE_OPS, async (message, c) => {
		await handle(c.ws, message, c.reply, ctx);
	});
}

type ConnectionContext = {
	lastPongAt: number;
	lastRttMs: number;
	connectedAt: number;
	deviceId?: string;
	deviceName?: string;
	platform?: string;
	protocolVersion?: string;
	projectPath?: string;
	sessionId?: string;
	viewAgent?: AgentType;
};

type PermissionWaiter = {
	resolve: (response: { response: "once" | "always" | "reject"; updatedInput?: Record<string, unknown> }) => void;
	timer: Timer;
};

type ElicitationWaiter = {
	resolve: (response: ClaudeElicitationReply) => void;
	timer: Timer;
};

export type DevicesHandlerContext = {
	sockets: Set<ServerWebSocket<unknown>>;
	contexts: Map<ServerWebSocket<unknown>, ConnectionContext>;
	ALLOWED_DEVICE_IDS: Set<string>;
	BRIDGE_PROTOCOL_VERSION: string;
	getDeviceInfo: (ws: ServerWebSocket<unknown>) => DeviceInfo | null;
	getAllDevices: () => DeviceInfo[];
	findSocketByDeviceId: (deviceId: string) => ServerWebSocket<unknown> | null;
	send: (ws: ServerWebSocket<unknown>, msg: ServerMessage) => void;
	broadcast: (msg: ServerMessage) => void;
	sendStatus: (ws: ServerWebSocket<unknown>) => Promise<void>;
	logUser: (msg: string) => void;
	logError: (msg: string, ...args: unknown[]) => void;
	safeString: (value: unknown) => string;
	// Active session state for push on connect
	claudeCode: {
		listActiveSessions: () => { sessionId: string; cwd: string; startedAt: number | undefined }[];
	};
	ccPermissionWaiters: Map<string, PermissionWaiter>;
	ccElicitationWaiters: Map<string, ElicitationWaiter>;
	buildClaudeCodeRuntimeState: (params: {
		sessionId: string;
		cwd?: string;
		isStreaming: boolean;
	}) => Record<string, unknown>;
};

export async function handle(
	ws: ServerWebSocket<unknown>,
	message: Record<string, unknown>,
	reply: ReplyFn,
	ctx: DevicesHandlerContext,
): Promise<boolean> {
	const type = message.type as string;
	switch (type) {
		case "register_device": {
			if (!message.deviceId || typeof message.deviceId !== "string" || (message.deviceId as string).length > 128) {
				reply({ type: "error", message: "Invalid deviceId" });
				try {
					ws.close(4004, "Invalid deviceId");
				} catch {
					// ignore
				}
				return true;
			}
			if (ctx.ALLOWED_DEVICE_IDS.size > 0 && !ctx.ALLOWED_DEVICE_IDS.has(message.deviceId as string)) {
				reply({ type: "error", message: "Device not allowed" });
				try {
					ws.close(4004, "Device not allowed");
				} catch {
					// ignore
				}
				return true;
			}
			const existing = ctx.contexts.get(ws) ?? {
				lastPongAt: Date.now(),
				lastRttMs: 0,
				connectedAt: Date.now(),
			};
			ctx.contexts.set(ws, {
				...existing,
				deviceId: message.deviceId as string,
				deviceName: message.deviceName as string | undefined,
				platform: message.platform as string | undefined,
				protocolVersion: ctx.safeString(message.protocolVersion) || undefined,
			});
			const deviceInfo = ctx.getDeviceInfo(ws);
			if (deviceInfo) {
				reply({
					type: "device_registered",
					data: deviceInfo,
					protocolVersion: ctx.BRIDGE_PROTOCOL_VERSION,
				} as ServerMessage);
				ctx.broadcast({ type: "device_connected", data: deviceInfo } as ServerMessage);
			}
			ctx.logUser(`Device registered: ${message.deviceName} (${message.platform})`);
			void ctx.sendStatus(ws);

			// Push active sessions on connect
			void pushActiveSessionsOnConnect(ws, ctx);
			return true;
		}
		case "list_devices": {
			const devices = ctx.getAllDevices();
			reply({ type: "devices", data: devices } as ServerMessage);
			return true;
		}
		case "disconnect_device": {
			const targetWs = ctx.findSocketByDeviceId(message.deviceId as string);
			if (targetWs && targetWs !== ws) {
				const targetCtx = ctx.contexts.get(targetWs);
				try {
					targetWs.close(4001, "Disconnected by another device");
				} catch {
					// ignore
				}
				ctx.broadcast({
					type: "device_disconnected",
					data: {
						deviceId: message.deviceId,
						deviceName: targetCtx?.deviceName,
					},
				} as ServerMessage);
			}
			return true;
		}
		default:
			return false;
	}
}

async function pushActiveSessionsOnConnect(ws: ServerWebSocket<unknown>, ctx: DevicesHandlerContext): Promise<void> {
	try {
		const activeCC = ctx.claudeCode.listActiveSessions().map((s) => ({
			sessionId: s.sessionId,
			cwd: s.cwd,
			startedAt: s.startedAt,
		}));

		const pendingCCPerms = Array.from(ctx.ccPermissionWaiters.keys()).map((key) => {
			const parts = key.split(":");
			return { sessionId: parts[0], toolUseId: parts[1] };
		});
		const pendingCCElicitations = pendingElicitations.pending();

		for (const active of activeCC) {
			ctx.send(ws, {
				type: "runtime_state",
				backend: "claude-code",
				data: ctx.buildClaudeCodeRuntimeState({
					sessionId: active.sessionId,
					cwd: active.cwd,
					isStreaming: true,
				}),
			} as ServerMessage);
		}

		ctx.send(ws, {
			type: "sessions_active",
			data: {
				claudeCode: activeCC,
				pendingPermissions: {
					claudeCode: pendingCCPerms,
					claudeCodeElicitations: pendingCCElicitations,
				},
			},
		} as ServerMessage);
	} catch (err) {
		ctx.logError("[sessions_active] Failed to build active sessions snapshot:", err);
	}
}
