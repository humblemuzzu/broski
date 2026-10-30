/**
 * What the driver's extension file shares with the test that loaded it. Pi loads that file through its
 * own module loader, which evaluates this module again, so the state lives on `globalThis`, not in a
 * module variable.
 */

declare global {
	var __broskiPiDriverBus: DriverBus | undefined;
}

export interface LifecycleRecord {
	readonly event: "start" | "shutdown";
	readonly sessionId: string;
}

/** What a dialog an extension opened returned to the extension. */
export interface AskRecord {
	readonly tag: string;
	readonly answer: string | boolean | undefined;
}

export type HoldEnd = "released" | "aborted";

interface Gate {
	readonly sessionId: string;
	entered: boolean;
	end: HoldEnd | undefined;
	finish: ((end: HoldEnd) => void) | undefined;
	whenEntered: (() => void)[];
}

export class DriverBus {
	readonly lifecycle: LifecycleRecord[] = [];
	readonly asks: AskRecord[] = [];
	readonly commandRuns: string[] = [];
	private readonly watchers: (() => void)[] = [];
	/** The abort controllers of dialogs an extension gave a signal of its own, by the dialog's tag. */
	private readonly ownSignals = new Map<string, AbortController>();
	/** When set, the extension asks a dialog from its `session_shutdown` handler and records the answer. */
	askOnShutdown = false;
	private readonly gates = new Map<string, Gate>();

	/** The extension's dialog `tag` returned `answer` to it. */
	recordAsk(tag: string, answer: AskRecord["answer"]): void {
		this.asks.push({ tag, answer });
		this.notify();
	}

	/** An extension command ran with `args`. */
	recordCommand(args: string): void {
		this.commandRuns.push(args);
		this.notify();
	}

	/** Resolves with the dialog's record once the extension has the answer to `tag`. */
	answered(tag: string): Promise<AskRecord> {
		return this.until(() => this.asks.find((ask) => ask.tag === tag));
	}

	/** Resolves once `count` extension commands have run. */
	commandsRan(count: number): Promise<void> {
		return this.until(() => (this.commandRuns.length >= count ? true : undefined)).then(() => undefined);
	}

	/** Resolves once the session's runtime has shut down (`session_shutdown` ran). */
	shutDown(sessionId: string): Promise<void> {
		const done = () => this.lifecycle.some((record) => record.sessionId === sessionId && record.event === "shutdown");
		return this.until(() => (done() ? true : undefined)).then(() => undefined);
	}

	recordLifecycle(record: LifecycleRecord): void {
		this.lifecycle.push(record);
		this.notify();
	}

	private until<T>(find: () => T | undefined): Promise<T> {
		const found = find();
		if (found !== undefined) return Promise.resolve(found);
		return new Promise((resolve) => {
			const check = () => {
				const match = find();
				if (match === undefined) return;
				this.watchers.splice(this.watchers.indexOf(check), 1);
				resolve(match);
			};
			this.watchers.push(check);
		});
	}

	private notify(): void {
		for (const check of [...this.watchers]) check();
	}

	/** A signal the extension's dialog `tag` watches, which `abortOwn` fires. */
	ownSignal(tag: string): AbortSignal {
		const controller = new AbortController();
		this.ownSignals.set(tag, controller);
		return controller.signal;
	}

	abortOwn(tag: string): void {
		this.ownSignals.get(tag)?.abort();
	}

	/** A gate for one `driver_hold` call of the session; the script names it in the call's arguments. */
	newGate(sessionId: string): string {
		const id = crypto.randomUUID();
		this.gates.set(id, { sessionId, entered: false, end: undefined, finish: undefined, whenEntered: [] });
		return id;
	}

	/** Parks the calling tool until the gate is released or `signal` aborts; either may already have happened. */
	hold(gateId: string, signal: AbortSignal | undefined): Promise<HoldEnd> {
		const gate = this.gates.get(gateId);
		if (!gate) throw new Error(`driver_hold names a gate that was never made: ${gateId}`);
		gate.entered = true;
		for (const notify of gate.whenEntered.splice(0)) notify();
		if (gate.end) return Promise.resolve(gate.end);
		if (signal?.aborted) return Promise.resolve("aborted");
		return new Promise((resolve) => {
			const onAbort = () => end("aborted");
			const end = (how: HoldEnd) => {
				signal?.removeEventListener("abort", onAbort);
				gate.finish = undefined;
				gate.end ??= how;
				resolve(how);
			};
			gate.finish = end;
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	/** Lets every hold of the session go on, including one not reached yet. */
	release(sessionId: string): void {
		for (const gate of this.gates.values()) {
			if (gate.sessionId !== sessionId || gate.end) continue;
			gate.end = "released";
			gate.finish?.("released");
		}
	}

	/** Resolves once a tool is parked at the session's newest gate. */
	entered(sessionId: string): Promise<void> {
		const gate = this.latestGate(sessionId);
		if (!gate) throw new Error(`session ${sessionId} has no gate`);
		if (gate.entered) return Promise.resolve();
		return new Promise((resolve) => gate.whenEntered.push(resolve));
	}

	private latestGate(sessionId: string): Gate | undefined {
		return [...this.gates.values()].findLast((gate) => gate.sessionId === sessionId);
	}

	/** Session ids whose runtime started and has not shut down, counted per start. */
	liveRuntimes(sessionId?: string): number {
		const relevant = this.lifecycle.filter((record) => sessionId === undefined || record.sessionId === sessionId);
		return (
			relevant.filter((record) => record.event === "start").length -
			relevant.filter((record) => record.event === "shutdown").length
		);
	}

	starts(sessionId: string): number {
		return this.lifecycle.filter((record) => record.sessionId === sessionId && record.event === "start").length;
	}
}

export function installDriverBus(): DriverBus {
	globalThis.__broskiPiDriverBus = new DriverBus();
	return globalThis.__broskiPiDriverBus;
}

export function removeDriverBus(): void {
	globalThis.__broskiPiDriverBus = undefined;
}

export function driverBus(): DriverBus {
	const bus = globalThis.__broskiPiDriverBus;
	if (!bus) throw new Error("no driver bus is installed: the extension ran outside a Pi test world");
	return bus;
}
