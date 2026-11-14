/**
 * What the hosting tests add to the live rig: an extension in the agent dir whose handlers a test can park
 * (`input`, `before_agent_start`, `agent_settled`, `session_shutdown`, a tool that ignores abort), and the
 * waits those tests need. The extension is evaluated by Pi's own module loader, so its gates live on `globalThis`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRef } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";

/** A handler of the extension parks here until the test releases it. */
export class Gate {
	readonly entered = Promise.withResolvers<void>();
	readonly released = Promise.withResolvers<void>();

	open(): void {
		this.released.resolve();
	}
}

export type GateName =
	| "inputGate"
	| "beforeStartGate"
	| "settleGate"
	| "shutdownGate"
	| "toolGate"
	| "loadGate"
	| "startGate"
	| "compactGate";

interface HostRigState {
	gates: Partial<Record<GateName, Gate>>;
	/** The handler of the extension that throws, by the name of the event it handles. */
	throwAt?: string;
	/** `session_start` asks a confirmation nobody can answer before the session is open. */
	askOnStart?: boolean;
	/** `PI_OFFLINE` as the extension's factory saw it while Pi loaded it. */
	offlineSeen: (string | undefined)[];
	/** `PI_OFFLINE` as a running tool saw it, after its gate opened. */
	toolSawOffline: (string | undefined)[];
	/**
	 * The handler that asks the human before Pi decides a prompt; an `input` one handles the prompt when told no, and
	 * `input-at-once` asks before it awaits anything, inside Pi's `prompt()` call.
	 */
	askOn?: "input" | "input-at-once" | "before_agent_start";
	/** What those asks got back. */
	answers: boolean[];
	/** The text of every input Pi passed its `input` handlers, in order. */
	inputs: string[];
}

declare global {
	var __hostRig: HostRigState | undefined;
}

const EXTENSION = `
export default async function (pi) {
	const state = globalThis.__hostRig;
	state.offlineSeen.push(process.env.PI_OFFLINE);
	const hold = async (name) => {
		const gate = state.gates[name];
		if (!gate) return;
		gate.entered.resolve();
		await gate.released.promise;
	};
	const holdUntilAborted = async (name, signal) => {
		const gate = state.gates[name];
		if (!gate) return;
		gate.entered.resolve();
		await new Promise((resolve) => {
			if (signal?.aborted) return resolve();
			signal?.addEventListener("abort", resolve, { once: true });
			gate.released.promise.then(resolve);
		});
	};
	const maybeThrow = (name) => {
		if (state.throwAt === name) throw new Error("boom in " + name);
	};
	await hold("loadGate");
	pi.on("session_start", async (_event, ctx) => {
		maybeThrow("session_start");
		if (state.askOnStart) await ctx.ui.confirm("Start?", "asked while the session opens");
		await hold("startGate");
	});
	pi.on("message_end", async () => {
		maybeThrow("message_end");
	});
	pi.on("session_before_compact", async (event) => {
		maybeThrow("session_before_compact");
		await holdUntilAborted("compactGate", event.signal);
	});
	pi.on("input", async (event, ctx) => {
		maybeThrow("input");
		state.inputs.push(event.text);
		if (state.askOn === "input-at-once") {
			state.answers.push(await ctx.ui.confirm("Send it?", "asked before anything is awaited"));
			return { action: "continue" };
		}
		await hold("inputGate");
		if (state.askOn !== "input") return { action: "continue" };
		const send = await ctx.ui.confirm("Send it?", "asked before the prompt is decided");
		state.answers.push(send);
		return send ? { action: "continue" } : { action: "handled" };
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		maybeThrow("before_agent_start");
		await hold("beforeStartGate");
		if (state.askOn === "before_agent_start") state.answers.push(await ctx.ui.confirm("Start?", "asked before the run"));
	});
	pi.on("agent_settled", async () => {
		maybeThrow("agent_settled");
		await hold("settleGate");
	});
	pi.on("session_shutdown", async () => {
		maybeThrow("session_shutdown");
		await hold("shutdownGate");
	});
	pi.registerTool({
		name: "ignore_abort",
		label: "Ignore abort",
		description: "Waits for the test and ignores the abort signal.",
		parameters: { type: "object", properties: {} },
		execute: async () => {
			maybeThrow("tool");
			await hold("toolGate");
			state.toolSawOffline.push(process.env.PI_OFFLINE);
			return { content: [{ type: "text", text: "finished" }], details: {} };
		},
	});
	pi.registerCommand("kick", {
		description: "Sends a user message",
		handler: async () => {
			pi.sendUserMessage("from the extension");
		},
	});
	pi.registerCommand("ask-later", {
		description: "Waits a moment, then asks",
		handler: async (_args, ctx) => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			state.answers.push(await ctx.ui.confirm("Later?", "asked after the command awaited"));
		},
	});
	pi.registerCommand("note", {
		description: "Sends a note that starts no turn",
		handler: async () => {
			pi.sendMessage({ customType: "host-rig", content: "a note", display: true });
		},
	});
}
`;

export class HostRig {
	private constructor(readonly rig: LiveRig) {}

	static async create(options: Parameters<typeof LiveRig.create>[0] = {}): Promise<HostRig> {
		globalThis.__hostRig = { gates: {}, offlineSeen: [], toolSawOffline: [], answers: [], inputs: [] };
		const rig = await LiveRig.create(options);
		const dir = join(rig.world.env.agentDir, "extensions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "host-rig.ts"), EXTENSION);
		return new HostRig(rig);
	}

	get hosts() {
		return this.rig.world.parts.hosts;
	}

	get bus() {
		return this.rig.bus;
	}

	get router() {
		return this.rig.router;
	}

	get state(): HostRigState {
		const state = globalThis.__hostRig;
		if (!state) throw new Error("the host rig's state is gone");
		return state;
	}

	/** The next time a handler of the extension reaches `name`, it parks until the gate is opened. */
	gate(name: GateName): Gate {
		const gate = new Gate();
		this.state.gates[name] = gate;
		return gate;
	}

	/** The live Pi session of a hosted session. */
	session(ref: SessionRef) {
		const session = this.hosts.session(ref.sessionId);
		if (!session) throw new Error(`session ${ref.sessionId} is not hosted`);
		return session;
	}

	async dispose(): Promise<void> {
		for (const gate of Object.values(this.state.gates)) gate.open();
		await this.rig.dispose();
		globalThis.__hostRig = undefined;
	}
}

export function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once `condition` holds; polls only because a test has nothing to await on. */
export async function until(condition: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
		await pause(5);
	}
}

export function eventTypes(live: LiveSession): string[] {
	return live.events().map((event) => event.type);
}

/** Counts the timers of a second or more (the adapter's deadlines) that were set and neither fired nor were cleared. */
export function trackLongTimers(minMs = 1_000): { outstanding(): number; stop(): void } {
	const realSet = globalThis.setTimeout;
	const realClear = globalThis.clearTimeout;
	const pending = new Set<unknown>();
	Reflect.set(globalThis, "setTimeout", (handler: () => void, ms?: number) => {
		if ((ms ?? 0) < minMs) return realSet(handler, ms);
		const handle = realSet(() => {
			pending.delete(handle);
			handler();
		}, ms);
		pending.add(handle);
		return handle;
	});
	Reflect.set(globalThis, "clearTimeout", (handle: Parameters<typeof clearTimeout>[0]) => {
		pending.delete(handle);
		realClear(handle);
	});
	return {
		outstanding: () => pending.size,
		stop: () => {
			Reflect.set(globalThis, "setTimeout", realSet);
			Reflect.set(globalThis, "clearTimeout", realClear);
		},
	};
}
