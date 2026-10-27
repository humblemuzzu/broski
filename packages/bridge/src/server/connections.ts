import type { ServerWebSocket } from "bun";
import * as cxRouting from "../handlers/cx_routing";
import * as piDurable from "../handlers/pi_durable";
import * as piFeatures from "../handlers/pi_features";
import type { PtyRuntime } from "../pty/runtime";
import type { AgentType, DeviceInfo } from "../types";
import type { BridgeLimits } from "./limits";
import { attachLinkFeed, detachLinkFeed, handleLinkFeedMessage } from "./link-feed/feed";
import { isLinkDaemonSocketData, linkContextFields } from "./link-identity";
import type { LeveledLogger } from "./logger";
import { makeSessionKey } from "./session-keys";
import type { Sessions } from "./sessions";
import type { BridgeState } from "./state";
import type { Streams } from "./streams";

type RateBucket = { tokens: number; lastRefill: number; blockedUntil: number };

export type Connections = {
	websocketConfig: Bun.WebSocketHandler<unknown>;
	getDeviceInfo: (ws: ServerWebSocket<unknown>) => DeviceInfo | null;
	getAllDevices: () => DeviceInfo[];
	findSocketByDeviceId: (deviceId: string) => ServerWebSocket<unknown> | null;
};

export type ConnectionsDeps = {
	state: BridgeState;
	streams: Streams;
	sessions: Sessions;
	log: LeveledLogger;
	limits: BridgeLimits;
	ptyRuntime: PtyRuntime;
	sendStatus: (ws: ServerWebSocket<unknown>) => Promise<void>;
	handleMessage: (ws: ServerWebSocket<unknown>, raw: string | Uint8Array) => Promise<void>;
};

/** WebSocket open/close/message handling, the token-bucket rate limiter, and device lookup. */
export function createConnections(deps: ConnectionsDeps): Connections {
	const { state, streams, sessions } = deps;
	const rateLimiters = new Map<ServerWebSocket<unknown>, RateBucket>();

	const getDeviceInfo = (ws: ServerWebSocket<unknown>): DeviceInfo | null => {
		const ctx = state.contexts.get(ws);
		if (!ctx?.deviceId) return null;
		return {
			deviceId: ctx.deviceId,
			deviceName: ctx.deviceName ?? "Unknown Device",
			platform: ctx.platform ?? "unknown",
			connectionType: ctx.connectionType,
			rttMs: ctx.lastRttMs,
			connectedAt: ctx.connectedAt,
			currentView:
				ctx.projectPath || ctx.sessionId ? { projectPath: ctx.projectPath, sessionId: ctx.sessionId } : undefined,
		};
	};

	const getAllDevices = (): DeviceInfo[] => {
		const devices: DeviceInfo[] = [];
		for (const ws of state.sockets) {
			const device = getDeviceInfo(ws);
			if (device) devices.push(device);
		}
		return devices;
	};

	const findSocketByDeviceId = (deviceId: string): ServerWebSocket<unknown> | null => {
		for (const ws of state.sockets) {
			const ctx = state.contexts.get(ws);
			if (ctx?.deviceId === deviceId) return ws;
		}
		return null;
	};

	const checkRateLimit = (ws: ServerWebSocket<unknown>): boolean => {
		const now = Date.now();
		const rate = deps.limits.rate;
		const bucket = rateLimiters.get(ws) ?? {
			tokens: rate.burst,
			lastRefill: now,
			blockedUntil: 0,
		};
		if (bucket.blockedUntil && now < bucket.blockedUntil) {
			rateLimiters.set(ws, bucket);
			return false;
		}
		const elapsedSec = (now - bucket.lastRefill) / 1000;
		bucket.tokens = Math.min(rate.burst, bucket.tokens + elapsedSec * rate.perSecond);
		bucket.lastRefill = now;
		if (bucket.tokens < 1) {
			bucket.blockedUntil = now + rate.blockMs;
			rateLimiters.set(ws, bucket);
			return false;
		}
		bucket.tokens -= 1;
		rateLimiters.set(ws, bucket);
		return true;
	};

	const websocketConfig = {
		// A phone that stops reading (backgrounded, dead radio, DERP relay gone) must not grow
		// the bridge: past 4 MiB buffered it is closed and the app reconnects + resyncs.
		backpressureLimit: deps.limits.wsBackpressureLimitBytes,
		closeOnBackpressureLimit: true,
		maxPayloadLength: deps.limits.maxWsMessageBytes,
		idleTimeout: deps.limits.wsIdleTimeoutSeconds,
		// On by default: 4.5× fewer bytes for streamed text and 16× for a session list on the
		// payloads bench/scenarios/ws-deflate.ts measures, for a few ms of CPU per megabyte.
		// `BROSKI_WS_DEFLATE=0` turns it off for a client whose compression is broken.
		perMessageDeflate: process.env.BROSKI_WS_DEFLATE !== "0",
		open(ws: ServerWebSocket<unknown>) {
			if (isLinkDaemonSocketData(ws.data)) {
				attachLinkFeed(ws, deps.log.logInfo);
				return;
			}
			const proxy = (ws.data as { kind?: string })?.kind === "proxy";
			if (proxy) {
				const d = ws.data as { port?: string | number; path?: string; search?: string };
				const port = Number(d.port);
				const path = typeof d.path === "string" ? d.path : "/";
				const search = typeof d.search === "string" ? d.search : "";
				const proto = state.tlsEnabled ? "wss" : "ws";
				const upstreamUrl = `${proto}://127.0.0.1:${port}${path}${search}`;
				try {
					const upstream = new WebSocket(upstreamUrl);
					(ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream = upstream;
					upstream.onmessage = (evt) => {
						const frame = typeof evt.data === "string" ? evt.data : new Uint8Array(evt.data as ArrayBuffer);
						if (state.runtimeSendQueue.sendRaw(ws, frame) === "dropped") {
							try {
								upstream.close();
							} catch {
								// ignore
							}
						}
					};
					upstream.onclose = () => {
						try {
							ws.close(1000, "Upstream closed");
						} catch {
							// ignore
						}
					};
					upstream.onerror = () => {
						try {
							ws.close(1011, "Upstream error");
						} catch {
							// ignore
						}
					};
				} catch {
					try {
						ws.close(1011, "Proxy init failed");
					} catch {
						// ignore
					}
				}
				return;
			}
			state.sockets.add(ws);
			rateLimiters.set(ws, {
				tokens: deps.limits.rate.burst,
				lastRefill: Date.now(),
				blockedUntil: 0,
			});
			state.contexts.set(ws, {
				lastPongAt: Date.now(),
				lastRttMs: 0,
				connectionType: "unknown",
				connectedAt: Date.now(),
				...linkContextFields(ws.data),
			});
			deps.log.logUser(`Client connected (${state.sockets.size} active)`);
			deps.log.logInfo(`[WS] Client CONNECTED (${state.sockets.size} total)`);
			void deps.sendStatus(ws);
		},
		close(ws: ServerWebSocket<unknown>, code?: number, reason?: string) {
			if (isLinkDaemonSocketData(ws.data)) {
				detachLinkFeed(ws);
				return;
			}
			deps.log.logUser(`Client disconnected`);
			deps.log.logInfo(`[WS] Client DISCONNECTED - code=${code}, reason=${reason}`);
			const proxy = (ws.data as { kind?: string })?.kind === "proxy";
			if (proxy) {
				const upstream = (ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream;
				(ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream = undefined;
				try {
					upstream?.close();
				} catch {
					// ignore
				}
				return;
			}
			const ctx = state.contexts.get(ws);
			deps.log.logInfo(`[WS] Disconnect context - deviceId=${ctx?.deviceId}`);
			const disconnectedDeviceId = ctx?.deviceId;
			const disconnectedDeviceName = ctx?.deviceName;
			const prevKey = makeSessionKey(ctx?.viewAgent, ctx?.sessionId);
			sessions.updateSessionWatchers(ws, prevKey, null);
			piDurable.detach(state.piDurableSockets.for(ws));
			cxRouting.detachCxFsWatches(ws, state.codexClient);

			// If this socket owned any CC/Codex/OpenCode sessions, release ownership so watchers
			// can fall back to external tailing (or another owner) correctly.
			const releasedKeys: Array<{ agent: AgentType; id: string }> = [];
			for (const [sid, owner] of state.ccSessionOwners.entries()) {
				if (owner === ws) {
					state.ccSessionOwners.delete(sid);
					releasedKeys.push({ agent: "claude-code", id: sid });
				}
			}
			for (const [tid, owner] of state.cxThreadOwners.entries()) {
				if (owner === ws) {
					state.cxThreadOwners.delete(tid);
					releasedKeys.push({ agent: "codex", id: tid });
				}
			}
			for (const [sid, owner] of state.ocSessionOwners.entries()) {
				if (owner === ws) {
					state.ocSessionOwners.delete(sid);
					releasedKeys.push({ agent: "opencode", id: sid });
				}
			}
			for (const k of releasedKeys) {
				sessions.syncExternalTailForKey(makeSessionKey(k.agent, k.id));
			}

			state.sockets.delete(ws);
			state.contexts.delete(ws);
			rateLimiters.delete(ws);
			state.runtimeSendQueue.disposeSocket(ws);

			// Pi watchers are registered per socket; a socket that goes away without another
			// set_view would otherwise keep its external tail polling for the session forever.
			for (const orphanedSessionId of piFeatures.prunePiWatchers((sock) => state.sockets.has(sock))) {
				piFeatures.stopPiExternalTail(orphanedSessionId);
			}

			// Remove client from active PTY subscriptions.
			deps.ptyRuntime.onClientDisconnected(ws);
			deps.log.log(`Client disconnected (${state.sockets.size} total)`);

			if (disconnectedDeviceId) {
				streams.broadcast({
					type: "device_disconnected",
					data: {
						deviceId: disconnectedDeviceId,
						deviceName: disconnectedDeviceName,
					},
				});
			}
		},
		message(ws: ServerWebSocket<unknown>, raw: string | Uint8Array) {
			if (isLinkDaemonSocketData(ws.data)) {
				handleLinkFeedMessage(ws, raw);
				return;
			}
			const proxy = (ws.data as { kind?: string })?.kind === "proxy";
			if (proxy) {
				const upstream = (ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream;
				try {
					if (upstream && upstream.readyState === WebSocket.OPEN) {
						upstream.send(typeof raw === "string" ? raw : new Uint8Array(raw));
					}
				} catch {
					// ignore
				}
				return;
			}
			const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
			if (bytes > deps.limits.maxWsMessageBytes) {
				try {
					ws.close(1009, "Message too large");
				} catch {
					// ignore
				}
				return;
			}
			if (!checkRateLimit(ws)) {
				// Best-effort: notify, but don't amplify further under load.
				try {
					streams.send(ws, { type: "error", message: "RATE_LIMITED" });
				} catch {
					// ignore
				}
				return;
			}
			void deps.handleMessage(ws, raw);
		},
		drain(ws: ServerWebSocket<unknown>) {
			state.runtimeSendQueue.onDrain(ws);
		},
	} satisfies Bun.WebSocketHandler<unknown>;

	return { websocketConfig, getDeviceInfo, getAllDevices, findSocketByDeviceId };
}
