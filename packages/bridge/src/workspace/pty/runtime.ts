import type { ManagedInterval } from "../../timers";
import { nodeInterval } from "../../timers";
import { GatedInterval } from "./health-timer";
import type { PtyManager } from "./manager";
import type { NativePtyConnection } from "./native-pty";
import { consumePtyOutput, createPtyBufferState, type PtyBufferState, pushPtyOutput } from "./output";
import type { PtyCreateOptions, PtyEvent, PtyListener, PtyResult, PtySession } from "./types";

const MAX_INPUT_CHARS = 10_000;
const MAX_DIMENSION = 500;
const RESPONSIVE_WITHIN_MS = 5000;
const UNAVAILABLE = "Terminal not available on this machine";

type PtyHealth = {
	lastInputTime: number;
	lastOutputTime: number;
	bytesIn: number;
	bytesOut: number;
};

type RuntimeDeps = {
	ptyManager: PtyManager;
	log: (message: string) => void;
	resolveSecurePath: (path: string) => Promise<string | null>;
	healthIntervalMs?: number;
	healthInterval?: ManagedInterval;
};

function dimension(value: number): number {
	return Math.max(1, Math.min(MAX_DIMENSION, Math.floor(value)));
}

function failed<T>(error: string): PtyResult<T> {
	return { ok: false, error };
}

/**
 * The machine's terminals and their listeners: each connected terminal's output is batched (`output.ts`) and
 * handed to every listener of it, with a health snapshot every second while anyone listens. A terminal nobody
 * listens to any more is disconnected (it keeps running in the native PTY library).
 */
export class PtyRuntime {
	private readonly ptyManager: PtyManager;
	private readonly log: RuntimeDeps["log"];
	private readonly resolveSecurePath: RuntimeDeps["resolveSecurePath"];

	private readonly nativeConnections = new Map<string, NativePtyConnection>();
	private readonly listeners = new Map<string, Set<PtyListener>>();
	private readonly outputBuffers = new Map<string, PtyBufferState>();
	private readonly health = new Map<string, PtyHealth>();
	private readonly healthTimer: GatedInterval;

	constructor(deps: RuntimeDeps) {
		this.ptyManager = deps.ptyManager;
		this.log = deps.log;
		this.resolveSecurePath = deps.resolveSecurePath;
		this.healthTimer = new GatedInterval({
			intervalMs: deps.healthIntervalMs ?? 1000,
			onTick: () => this.sendHealthSnapshots(),
			interval: deps.healthInterval ?? nodeInterval,
		});
	}

	async stop(): Promise<void> {
		this.healthTimer.stop();
		for (const ptyId of new Set([...this.nativeConnections.keys(), ...this.listeners.keys()])) {
			this.cleanup(ptyId, { closeUpstream: true });
		}
		await this.ptyManager.stop();
	}

	async list(projectPath?: string): Promise<PtyResult<PtySession[]>> {
		if (!this.ptyManager.available) return failed(UNAVAILABLE);
		return { ok: true, value: await this.ptyManager.listPty(projectPath) };
	}

	async create(options: PtyCreateOptions): Promise<PtyResult<PtySession>> {
		if (!this.ptyManager.available) return failed(UNAVAILABLE);
		let cwd: string | undefined;
		const requested = options.cwd?.trim() ?? "";
		if (requested) {
			const secure = await this.resolveSecurePath(requested);
			if (!secure) return failed("Invalid terminal directory");
			cwd = secure;
		}
		const pty = await this.ptyManager.createPty({
			command: options.command,
			args: options.args,
			cwd,
			title: options.title,
		});
		return pty ? { ok: true, value: pty } : failed("Failed to create PTY session");
	}

	async get(ptyId: string): Promise<PtyResult<PtySession>> {
		const pty = await this.ptyManager.getPty(ptyId);
		return pty ? { ok: true, value: pty } : failed("PTY session not found");
	}

	async update(
		ptyId: string,
		change: { title?: string; rows?: number; cols?: number },
	): Promise<PtyResult<PtySession>> {
		const rows = change.rows === undefined ? undefined : dimension(change.rows);
		const cols = change.cols === undefined ? undefined : dimension(change.cols);
		const pty = await this.ptyManager.updatePty(ptyId, change.title, rows, cols);
		return pty ? { ok: true, value: pty } : failed("Failed to update PTY session");
	}

	/** Ends the terminal and lets its listeners go; true when the native library had it. */
	async delete(ptyId: string): Promise<boolean> {
		const deleted = await this.ptyManager.deletePty(ptyId);
		this.cleanup(ptyId, { closeUpstream: true });
		return deleted;
	}

	/** Adds `listener` to the terminal, connecting to it first when nobody listens yet. */
	connect(ptyId: string, listener: PtyListener): PtyResult<null> {
		if (this.nativeConnections.has(ptyId)) {
			this.listenersOf(ptyId).add(listener);
			return { ok: true, value: null };
		}
		const connection = this.ptyManager.connectNative(ptyId);
		if (!connection) return failed("PTY session not found");
		this.listenersOf(ptyId).add(listener);
		this.nativeConnections.set(ptyId, connection);
		this.healthOf(ptyId);
		connection.onData((data) => this.queueOutput(ptyId, data));
		connection.onExit((exitCode) => {
			this.nativeConnections.delete(ptyId);
			this.exited(ptyId, exitCode);
		});
		return { ok: true, value: null };
	}

	disconnect(ptyId: string, listener: PtyListener): void {
		const listeners = this.listeners.get(ptyId);
		if (!listeners?.delete(listener)) return;
		if (listeners.size === 0) this.cleanup(ptyId, { closeUpstream: true });
	}

	/** A client went away: it stops listening to every terminal. */
	forget(listener: PtyListener): void {
		for (const ptyId of [...this.listeners.keys()]) this.disconnect(ptyId, listener);
	}

	input(ptyId: string, data: string): PtyResult<null> {
		if (data.length > MAX_INPUT_CHARS) return failed("Input too large (max 10KB)");
		const connection = this.nativeConnections.get(ptyId);
		if (!connection) return failed("PTY is not connected");
		const health = this.healthOf(ptyId);
		health.lastInputTime = Date.now();
		health.bytesIn += data.length;
		connection.write(data);
		return { ok: true, value: null };
	}

	resize(ptyId: string, rows: number, cols: number): void {
		this.ptyManager.resize(ptyId, dimension(rows), dimension(cols));
	}

	private listenersOf(ptyId: string): Set<PtyListener> {
		let listeners = this.listeners.get(ptyId);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(ptyId, listeners);
			this.healthTimer.ensureRunning();
		}
		return listeners;
	}

	private healthOf(ptyId: string): PtyHealth {
		let health = this.health.get(ptyId);
		if (!health) {
			const now = Date.now();
			health = { lastInputTime: now, lastOutputTime: now, bytesIn: 0, bytesOut: 0 };
			this.health.set(ptyId, health);
			this.healthTimer.ensureRunning();
		}
		return health;
	}

	/** Hands `event` to every listener of the terminal; a listener that throws is dropped. */
	private tell(ptyId: string, event: PtyEvent): void {
		const listeners = this.listeners.get(ptyId);
		if (!listeners) return;
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch {
				listeners.delete(listener);
			}
		}
	}

	private flushOutput(ptyId: string): void {
		const state = this.outputBuffers.get(ptyId);
		if (!state || state.buffer.length === 0) {
			if (state) state.timer = null;
			return;
		}
		const data = consumePtyOutput(state);
		const listeners = this.listeners.get(ptyId);
		if (!listeners || listeners.size === 0) return;
		this.tell(ptyId, { type: "output", ptyId, data });
		if (listeners.size === 0) this.cleanup(ptyId, { closeUpstream: true });
	}

	private cleanup(ptyId: string, options: { closeUpstream: boolean }): void {
		const buffer = this.outputBuffers.get(ptyId);
		if (buffer?.timer) clearTimeout(buffer.timer);
		this.flushOutput(ptyId);
		this.outputBuffers.delete(ptyId);
		this.health.delete(ptyId);
		this.listeners.delete(ptyId);
		const connection = this.nativeConnections.get(ptyId);
		if (options.closeUpstream && connection) {
			try {
				connection.disconnect();
			} catch {
				// already gone
			}
		}
		this.nativeConnections.delete(ptyId);
	}

	private queueOutput(ptyId: string, data: string): void {
		if (!data) return;
		const now = Date.now();
		const health = this.healthOf(ptyId);
		health.lastOutputTime = now;
		health.bytesOut += data.length;

		let buffer = this.outputBuffers.get(ptyId);
		if (!buffer) {
			buffer = createPtyBufferState();
			this.outputBuffers.set(ptyId, buffer);
		}
		const queued = pushPtyOutput(buffer, data, now);
		if (queued.didTruncate) this.log(`[PTY] Output truncated for ${ptyId} (backpressure protection)`);
		if (!buffer.timer) buffer.timer = setTimeout(() => this.flushOutput(ptyId), queued.flushDelayMs);
		if (queued.shouldFlushNow) this.flushOutput(ptyId);
	}

	private exited(ptyId: string, exitCode?: number): void {
		this.flushOutput(ptyId);
		this.tell(ptyId, { type: "exit", ptyId, exitCode });
		this.cleanup(ptyId, { closeUpstream: false });
	}

	private sendHealthSnapshots(): boolean {
		const now = Date.now();
		let sent = 0;
		for (const [ptyId, health] of this.health.entries()) {
			if (!this.listeners.get(ptyId)?.size) continue;
			sent++;
			this.tell(ptyId, {
				type: "health",
				ptyId,
				...health,
				isResponsive: now - health.lastOutputTime < RESPONSIVE_WITHIN_MS,
			});
		}
		return sent > 0;
	}
}
