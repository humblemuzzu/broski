import type { ServerWebSocket } from "bun";
import type { ManagedInterval } from "../timers";
import { nodeInterval } from "../timers";
import type { ServerMessage } from "../types";
import { GatedInterval } from "./health-timer";
import type { PtyManager } from "./manager";
import type { NativePtyConnection } from "./native-pty";
import { consumePtyOutput, createPtyBufferState, type PtyBufferState, pushPtyOutput } from "./output";
import type { PtyClientMessage, PtyReply } from "./types";

type PtyHealth = {
	lastInputTime: number;
	lastOutputTime: number;
	bytesIn: number;
	bytesOut: number;
};

type RuntimeDeps = {
	ptyManager: PtyManager;
	send: (ws: ServerWebSocket<unknown>, message: ServerMessage) => void;
	log: (message: string) => void;
	resolveSecurePath: (path: string) => Promise<string | null>;
	healthIntervalMs?: number;
	healthInterval?: ManagedInterval;
};

export class PtyRuntime {
	private readonly ptyManager: PtyManager;
	private readonly send: RuntimeDeps["send"];
	private readonly log: RuntimeDeps["log"];
	private readonly resolveSecurePath: RuntimeDeps["resolveSecurePath"];

	private readonly nativeConnections = new Map<string, NativePtyConnection>();
	private readonly ptyListeners = new Map<string, Set<ServerWebSocket<unknown>>>();
	private readonly ptyOutputBuffers = new Map<string, PtyBufferState>();
	private readonly ptyHealth = new Map<string, PtyHealth>();
	private readonly healthTimer: GatedInterval;

	constructor(deps: RuntimeDeps) {
		this.ptyManager = deps.ptyManager;
		this.send = deps.send;
		this.log = deps.log;
		this.resolveSecurePath = deps.resolveSecurePath;

		this.healthTimer = new GatedInterval({
			intervalMs: deps.healthIntervalMs ?? 1000,
			onTick: () => this.broadcastHealthSnapshots(),
			interval: deps.healthInterval ?? nodeInterval,
		});
	}

	async stop(): Promise<void> {
		this.healthTimer.stop();

		const ptyIds = new Set<string>([...this.nativeConnections.keys(), ...this.ptyListeners.keys()]);

		for (const ptyId of ptyIds) {
			this.cleanupPtyState(ptyId, { clearListeners: true, closeUpstream: true });
		}

		await this.ptyManager.stop();
	}

	onClientDisconnected(ws: ServerWebSocket<unknown>): void {
		for (const [ptyId, listeners] of this.ptyListeners.entries()) {
			if (!listeners.delete(ws)) continue;
			if (listeners.size === 0) {
				this.closePtyIfNoListeners(ptyId);
			}
		}
	}

	async handleMessage(ws: ServerWebSocket<unknown>, message: PtyClientMessage, reply: PtyReply): Promise<boolean> {
		switch (message.type) {
			case "list_pty": {
				if (!this.ptyManager.available) {
					reply({ type: "error", message: "Terminal not available on this machine" });
					break;
				}
				const ptys = await this.ptyManager.listPty(message.projectPath);
				reply({ type: "pty_list", data: ptys });
				break;
			}

			case "create_pty": {
				if (!this.ptyManager.available) {
					reply({ type: "error", message: "Terminal not available on this machine" });
					break;
				}

				let cwd = message.cwd;
				const requested = (message.cwd ?? message.projectPath ?? "").trim();
				if (requested) {
					const securePath = await this.resolveSecurePath(requested);
					if (!securePath) {
						reply({ type: "error", message: "Invalid terminal directory" });
						break;
					}
					cwd = securePath;
				}

				const pty = await this.ptyManager.createPty({
					command: message.command,
					args: message.args,
					cwd,
					title: message.title,
				});

				if (!pty) {
					reply({ type: "error", message: "Failed to create PTY session" });
					break;
				}

				reply({ type: "pty_created", data: pty });
				break;
			}

			case "get_pty": {
				const pty = await this.ptyManager.getPty(message.ptyId);
				if (!pty) {
					reply({ type: "error", message: "PTY session not found" });
					break;
				}
				reply({ type: "pty", data: pty });
				break;
			}

			case "update_pty": {
				const rows =
					typeof message.rows === "number" ? Math.max(1, Math.min(500, Math.floor(message.rows))) : undefined;
				const cols =
					typeof message.cols === "number" ? Math.max(1, Math.min(500, Math.floor(message.cols))) : undefined;

				const pty = await this.ptyManager.updatePty(message.ptyId, message.title, rows, cols);

				if (!pty) {
					reply({ type: "error", message: "Failed to update PTY session" });
					break;
				}
				reply({ type: "pty_updated", data: pty });
				break;
			}

			case "delete_pty": {
				const deleted = await this.ptyManager.deletePty(message.ptyId);
				this.cleanupPtyState(message.ptyId, { clearListeners: true, closeUpstream: true });
				reply({ type: "pty_deleted", data: deleted, ptyId: message.ptyId });
				break;
			}

			case "pty_connect": {
				this.connectPty(ws, message.ptyId, reply);
				break;
			}

			case "pty_input": {
				const data = typeof message.data === "string" ? message.data : "";
				if (data.length > 10_000) {
					this.send(ws, {
						type: "pty_error",
						ptyId: message.ptyId,
						error: "Input too large (max 10KB)",
					});
					break;
				}

				const health = this.ensurePtyHealth(message.ptyId);
				health.lastInputTime = Date.now();
				health.bytesIn += data.length;

				const nativeConn = this.nativeConnections.get(message.ptyId);
				if (nativeConn) {
					nativeConn.write(data);
					break;
				}

				this.send(ws, { type: "pty_error", ptyId: message.ptyId, error: "PTY is not connected" });
				break;
			}

			case "pty_disconnect": {
				const listeners = this.ptyListeners.get(message.ptyId);
				listeners?.delete(ws);
				if (listeners && listeners.size === 0) {
					this.closePtyIfNoListeners(message.ptyId);
				}
				reply({ type: "pty_disconnected", data: { ptyId: message.ptyId } });
				break;
			}

			case "pty_resize": {
				const rows = Math.max(1, Math.min(500, Math.floor(message.rows)));
				const cols = Math.max(1, Math.min(500, Math.floor(message.cols)));
				this.ptyManager.resize(message.ptyId, rows, cols);
				break;
			}

			default:
				return false;
		}

		return true;
	}

	private getPtyListeners(ptyId: string): Set<ServerWebSocket<unknown>> {
		const existing = this.ptyListeners.get(ptyId);
		if (existing) return existing;
		const created = new Set<ServerWebSocket<unknown>>();
		this.ptyListeners.set(ptyId, created);
		this.healthTimer.ensureRunning();
		return created;
	}

	private ensurePtyBuffer(ptyId: string): PtyBufferState {
		const existing = this.ptyOutputBuffers.get(ptyId);
		if (existing) return existing;
		const created: PtyBufferState = createPtyBufferState();
		this.ptyOutputBuffers.set(ptyId, created);
		return created;
	}

	private ensurePtyHealth(ptyId: string): PtyHealth {
		const existing = this.ptyHealth.get(ptyId);
		if (existing) return existing;
		const now = Date.now();
		const created: PtyHealth = {
			lastInputTime: now,
			lastOutputTime: now,
			bytesIn: 0,
			bytesOut: 0,
		};
		this.ptyHealth.set(ptyId, created);
		this.healthTimer.ensureRunning();
		return created;
	}

	private flushPtyOutput(ptyId: string): void {
		const state = this.ptyOutputBuffers.get(ptyId);
		if (!state || state.buffer.length === 0) {
			if (state) state.timer = null;
			return;
		}

		const data = consumePtyOutput(state);

		const listeners = this.ptyListeners.get(ptyId);
		if (!listeners || listeners.size === 0) return;

		const deadClients: ServerWebSocket<unknown>[] = [];
		for (const client of listeners) {
			try {
				this.send(client, { type: "pty_output", ptyId, data });
			} catch {
				deadClients.push(client);
			}
		}

		for (const client of deadClients) {
			listeners.delete(client);
		}

		if (listeners.size === 0) {
			this.closePtyIfNoListeners(ptyId);
		}
	}

	private closePtyIfNoListeners(ptyId: string): void {
		const listeners = this.ptyListeners.get(ptyId);
		if (listeners && listeners.size > 0) return;

		this.cleanupPtyState(ptyId, { clearListeners: true, closeUpstream: true });
	}

	private cleanupPtyState(ptyId: string, opts: { clearListeners: boolean; closeUpstream: boolean }): void {
		const buffer = this.ptyOutputBuffers.get(ptyId);
		if (buffer?.timer) clearTimeout(buffer.timer);
		this.flushPtyOutput(ptyId);
		this.ptyOutputBuffers.delete(ptyId);
		this.ptyHealth.delete(ptyId);

		if (opts.clearListeners) {
			this.ptyListeners.delete(ptyId);
		}

		if (opts.closeUpstream) {
			const nativeConn = this.nativeConnections.get(ptyId);
			if (nativeConn) {
				try {
					nativeConn.disconnect();
				} catch {
					// ignore
				}
			}
		}

		this.nativeConnections.delete(ptyId);
	}

	private queuePtyOutput(ptyId: string, data: string): void {
		if (!data) return;

		const now = Date.now();
		const health = this.ensurePtyHealth(ptyId);
		health.lastOutputTime = now;
		health.bytesOut += data.length;

		const buffer = this.ensurePtyBuffer(ptyId);
		const queued = pushPtyOutput(buffer, data, now);

		if (queued.didTruncate) {
			this.log(`[PTY] Output truncated for ${ptyId} (backpressure protection)`);
		}

		if (!buffer.timer) {
			buffer.timer = setTimeout(() => this.flushPtyOutput(ptyId), queued.flushDelayMs);
		}
		if (queued.shouldFlushNow) {
			this.flushPtyOutput(ptyId);
		}
	}

	private emitPtyError(ptyId: string, error: string): void {
		const listeners = this.ptyListeners.get(ptyId);
		if (!listeners || listeners.size === 0) return;

		const deadClients: ServerWebSocket<unknown>[] = [];
		for (const client of listeners) {
			try {
				this.send(client, { type: "pty_error", ptyId, error });
			} catch {
				deadClients.push(client);
			}
		}

		for (const client of deadClients) {
			listeners.delete(client);
		}
	}

	private emitPtyExit(ptyId: string, exitCode?: number): void {
		this.flushPtyOutput(ptyId);

		const listeners = this.ptyListeners.get(ptyId);
		if (!listeners || listeners.size === 0) {
			this.cleanupPtyState(ptyId, { clearListeners: true, closeUpstream: false });
			return;
		}

		for (const client of listeners) {
			this.send(client, { type: "pty_exit", ptyId, exitCode });
		}

		this.cleanupPtyState(ptyId, { clearListeners: true, closeUpstream: false });
	}

	private broadcastHealthSnapshots(): boolean {
		const now = Date.now();
		let sent = 0;

		for (const [ptyId, health] of this.ptyHealth.entries()) {
			const listeners = this.ptyListeners.get(ptyId);
			if (!listeners || listeners.size === 0) continue;
			sent++;

			const isResponsive = now - health.lastOutputTime < 5000;
			const deadClients: ServerWebSocket<unknown>[] = [];
			for (const client of listeners) {
				try {
					this.send(client, {
						type: "pty_health",
						ptyId,
						lastInputTime: health.lastInputTime,
						lastOutputTime: health.lastOutputTime,
						bytesIn: health.bytesIn,
						bytesOut: health.bytesOut,
						isResponsive,
					});
				} catch {
					deadClients.push(client);
				}
			}
			for (const client of deadClients) {
				listeners.delete(client);
			}
		}

		return sent > 0;
	}

	private connectPty(ws: ServerWebSocket<unknown>, ptyId: string, reply: PtyReply): void {
		this.getPtyListeners(ptyId).add(ws);

		if (this.nativeConnections.has(ptyId)) {
			reply({ type: "pty_connected", data: { ptyId } });
			return;
		}

		const nativeConn = this.ptyManager.connectNative(ptyId);
		if (!nativeConn) {
			this.emitPtyError(ptyId, "PTY session not found");
			reply({ type: "error", message: "PTY session not found" });
			return;
		}

		this.nativeConnections.set(ptyId, nativeConn);
		this.ensurePtyHealth(ptyId);

		nativeConn.onData((data) => {
			this.queuePtyOutput(ptyId, data);
		});

		nativeConn.onExit((exitCode) => {
			this.nativeConnections.delete(ptyId);
			this.emitPtyExit(ptyId, exitCode);
		});

		reply({ type: "pty_connected", data: { ptyId } });
	}
}
