/**
 * What the hosting tests add to the live rig: an extension in the agent dir whose handlers a test can park (`input`,
 * `before_agent_start`, `agent_settled`, `session_shutdown`, loading, `session_start`, a compaction, a tool that ignores
 * abort), and the waits those tests need. The extension runs in each `pi`, so it parks at gates of the scripted endpoint
 * (`rig:<name>`, open unless the test armed them; never in a catalog probe's `pi --no-session`), reads what the test set from `host-rig.json` in the agent dir each
 * time a handler runs, and reports the human's answers and the inputs it saw in notes (`PiRouter`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRef } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import type { ArmedGate } from "./helpers/pi-router";

export type GateName =
	| "inputGate"
	| "beforeStartGate"
	| "settleGate"
	| "shutdownGate"
	| "toolGate"
	| "loadGate"
	| "startGate"
	| "compactGate";

export interface HostRigSettings {
	/** The handler of the extension that throws, by the name of the event it handles. */
	readonly throwAt?: string;
	/** `session_start` asks a confirmation nobody can answer before the session is open. */
	readonly askOnStart?: boolean;
	/**
	 * The handler that asks the human before Pi decides a prompt; an `input` one handles the prompt when told no, and
	 * `input-at-once` asks before it awaits anything.
	 */
	readonly askOn?: "input" | "input-at-once" | "before_agent_start";
}

const EXTENSION = `
import { readFileSync } from "node:fs";
import { join } from "node:path";

const endpoint = process.env.BROSKI_TEST_ENDPOINT;
const settings = () => JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "host-rig.json"), "utf8"));
const note = (body) => fetch(endpoint + "/note", { method: "POST", body: JSON.stringify(body) });
const probing = process.argv.includes("--no-session");
const hold = (name, signal) =>
	probing
		? Promise.resolve("open")
		: fetch(endpoint + "/gate/rig:" + name, { signal }).then((response) => response.text(), () => "aborted");
const maybeThrow = (name) => {
	if (settings().throwAt === name) throw new Error("boom in " + name);
};
const asked = async (answer) => {
	await note({ kind: "ask", tag: "rig", answer });
	return answer;
};

export default async function (pi) {
	await hold("loadGate");
	pi.on("session_start", async (_event, ctx) => {
		maybeThrow("session_start");
		if (settings().askOnStart) await asked(await ctx.ui.confirm("Start?", "asked while the session opens"));
		await hold("startGate");
	});
	pi.on("message_end", async () => {
		maybeThrow("message_end");
	});
	pi.on("session_before_compact", async (event) => {
		maybeThrow("session_before_compact");
		await hold("compactGate", event.signal);
	});
	pi.on("input", async (event, ctx) => {
		maybeThrow("input");
		await note({ kind: "input", text: event.text });
		const { askOn } = settings();
		if (askOn === "input-at-once") {
			await asked(await ctx.ui.confirm("Send it?", "asked before anything is awaited"));
			return { action: "continue" };
		}
		await hold("inputGate");
		if (askOn !== "input") return { action: "continue" };
		const send = await asked(await ctx.ui.confirm("Send it?", "asked before the prompt is decided"));
		return send ? { action: "continue" } : { action: "handled" };
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		maybeThrow("before_agent_start");
		await hold("beforeStartGate");
		if (settings().askOn === "before_agent_start") await asked(await ctx.ui.confirm("Start?", "asked before the run"));
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
			await asked(await ctx.ui.confirm("Later?", "asked after the command awaited"));
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
		const rig = await LiveRig.create(options);
		const hostRig = new HostRig(rig);
		hostRig.set({});
		const dir = join(rig.world.env.agentDir, "extensions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "host-rig.ts"), EXTENSION);
		return hostRig;
	}

	get hosts() {
		return this.rig.world.parts.hosts;
	}

	get router() {
		return this.rig.router;
	}

	/** What the extension's handlers do from now on, in every `pi`. */
	set(settings: HostRigSettings): void {
		writeFileSync(join(this.rig.world.env.agentDir, "host-rig.json"), JSON.stringify(settings));
	}

	/** What the human answered the extension's asks, in order. */
	get answers(): readonly (string | boolean | null)[] {
		return this.router.asks.filter((ask) => ask.tag === "rig").map((ask) => ask.answer);
	}

	/** The text of every input Pi passed its `input` handlers, in order. */
	get inputs(): readonly string[] {
		return this.router.inputs;
	}

	/** From now on a handler of the extension that reaches `name` parks until the gate is opened. */
	gate(name: GateName): ArmedGate {
		return this.router.arm(`rig:${name}`);
	}

	/** The host of a hosted session. */
	host(ref: SessionRef) {
		const host = this.hosts.host(ref.sessionId);
		if (!host) throw new Error(`session ${ref.sessionId} is not hosted`);
		return host;
	}

	async dispose(): Promise<void> {
		this.router.openArmed();
		await this.rig.dispose();
	}
}

export function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once `condition` holds, running `look` before each check; polls only because a test has nothing to await on. */
export async function until(
	condition: () => boolean,
	what: string,
	timeoutMs = 10_000,
	look?: () => Promise<void>,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await look?.();
		if (condition()) return;
		if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
		await pause(5);
	}
}

export function eventTypes(live: LiveSession): string[] {
	return live.events().map((event) => event.type);
}

/** Counts the timers of a second or more (the adapter's deadlines) that were set and neither fired nor were cleared. */
export function trackLongTimers(minMs = 1_000): { outstanding(): number; setBy(): string[]; stop(): void } {
	const realSet = globalThis.setTimeout;
	const realClear = globalThis.clearTimeout;
	const pending = new Map<unknown, string>();
	Reflect.set(globalThis, "setTimeout", (handler: () => void, ms?: number) => {
		if ((ms ?? 0) < minMs) return realSet(handler, ms);
		const handle = realSet(() => {
			pending.delete(handle);
			handler();
		}, ms);
		pending.set(handle, new Error(`a ${ms} ms timer`).stack ?? "");
		return handle;
	});
	Reflect.set(globalThis, "clearTimeout", (handle: Parameters<typeof clearTimeout>[0]) => {
		pending.delete(handle);
		realClear(handle);
	});
	return {
		outstanding: () => pending.size,
		/** Where each outstanding timer was set, for the failure that names them. */
		setBy: () => [...pending.values()],
		stop: () => {
			Reflect.set(globalThis, "setTimeout", realSet);
			Reflect.set(globalThis, "clearTimeout", realClear);
		},
	};
}
