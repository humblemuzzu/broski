import { afterEach, describe, expect, test } from "bun:test";
import type { TerminalAskHandler } from "../../../backends/claude-code/ports/terminal";
import type { SessionRef } from "../../../contract";
import { createTerminalHookReceiver } from "../../../server/cc-terminal-hook";
import { makeLoopbackCert } from "./tls";

const SESSION = "5d3a4c6e-1b2f-4a8e-9c7d-0e1f2a3b4c5d";
const INPUT = {
	hook_event_name: "PermissionRequest",
	session_id: SESSION,
	transcript_path: "/tmp/x.jsonl",
	cwd: "/tmp/project",
	tool_name: "Bash",
	tool_input: { command: "ls" },
	permission_mode: "default",
};

interface Rig {
	readonly calls: string[];
	readonly seen: { signal?: AbortSignal; ask?: unknown };
	url: string;
	post(body: unknown, init?: RequestInit): Promise<Response>;
}

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

function serve(options: {
	handler?: TerminalAskHandler;
	hold?: (ref: SessionRef) => Promise<{ status: string }>;
}): Rig {
	const calls: string[] = [];
	const seen: Rig["seen"] = {};
	const receiver = createTerminalHookReceiver({
		hold: async (ref) => {
			calls.push("hold");
			return options.hold ? options.hold(ref) : { status: "accepted" };
		},
		release: () => calls.push("release"),
		log: () => undefined,
	});
	if (options.handler) {
		const inner = options.handler;
		receiver.setHandler((ask, signal) => {
			calls.push("handler");
			seen.signal = signal;
			seen.ask = ask;
			return inner(ask, signal);
		});
	}
	const cert = makeLoopbackCert();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		tls: { key: Bun.file(cert.keyPath), cert: Bun.file(cert.certPath) },
		fetch: (request) => receiver.handle(request),
	});
	stops.push(() => {
		server.stop(true);
		cert.cleanup();
	});
	const url = `https://127.0.0.1:${server.port}/cc-terminal-hook`;
	return {
		calls,
		seen,
		url,
		post: (body, init) =>
			fetch(url, {
				method: "POST",
				body: typeof body === "string" ? body : JSON.stringify(body),
				tls: { ca: Bun.file(cert.certPath) },
				...init,
			}),
	};
}

describe("the terminal hook receiver", () => {
	test("a person's allow is the hook's JSON body, the handler is told first and the session held while it waits", async () => {
		const rig = serve({
			handler: async () => {
				await Bun.sleep(30);
				return { behavior: "allow" };
			},
		});
		const response = await rig.post(INPUT);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
		});
		expect(rig.calls).toEqual(["handler", "hold", "release"]);
		expect(rig.seen.ask).toMatchObject({ session_id: SESSION, tool_name: "Bash", tool_input: { command: "ls" } });
	});

	test("an adapter that declines at once (a session the bridge hosts) is not given a held session", async () => {
		const rig = serve({ handler: async () => undefined });
		expect(await (await rig.post(INPUT)).json()).toEqual({});
		expect(rig.calls).toEqual(["handler"]);
	});

	test("a deny keeps its message and interrupt", async () => {
		const rig = serve({ handler: async () => ({ behavior: "deny", message: "no thanks", interrupt: true }) });
		expect(await (await rig.post(INPUT)).json()).toEqual({
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "deny", message: "no thanks", interrupt: true },
			},
		});
	});

	test("no decision, no handler, and a handler that throws all leave the decision to the terminal", async () => {
		for (const handler of [
			async () => undefined,
			async (): Promise<never> => {
				throw new Error("adapter bug");
			},
		]) {
			expect(await (await serve({ handler }).post(INPUT)).json()).toEqual({});
		}
		const none = serve({});
		expect(await (await none.post(INPUT)).json()).toEqual({});
		expect(none.calls).toEqual([]);
	});

	test("a handler that throws at once, and a hold that fails, both leave the decision to the terminal", async () => {
		const throwing = serve({
			handler: () => {
				throw new Error("adapter bug");
			},
		});
		expect(await (await throwing.post(INPUT)).json()).toEqual({});
		const failing = serve({
			handler: (_ask, signal) =>
				new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
			hold: async () => {
				throw new Error("seam bug");
			},
		});
		expect(await (await failing.post(INPUT)).json()).toEqual({});
		expect(failing.seen.signal?.aborted).toBe(true);
	});

	test("a session that cannot be held is not asked about: the handler is told to stop, nothing is released", async () => {
		const rig = serve({
			handler: (_ask, signal) =>
				new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
			hold: async () => ({ status: "rejected" }),
		});
		expect(await (await rig.post(INPUT)).json()).toEqual({});
		expect(rig.calls).toEqual(["handler", "hold"]);
		expect(rig.seen.signal?.aborted).toBe(true);
	});

	test("the CLI dropping the request tells the handler, which is the only thing that ends the wait", async () => {
		let answered = false;
		const rig = serve({
			handler: (_ask, signal) =>
				new Promise((resolve) =>
					signal.addEventListener(
						"abort",
						() => {
							answered = true;
							resolve(undefined);
						},
						{ once: true },
					),
				),
		});
		const controller = new AbortController();
		const pending = rig.post(INPUT, { signal: controller.signal }).then(
			() => "answered",
			() => "dropped",
		);
		await Bun.sleep(300);
		expect(answered).toBe(false);
		expect(rig.calls).toEqual(["handler", "hold"]);
		controller.abort();
		expect(await pending).toBe("dropped");
		for (let waited = 0; !rig.calls.includes("release") && waited < 2_000; waited += 20) await Bun.sleep(20);
		expect(answered).toBe(true);
		expect(rig.calls).toEqual(["handler", "hold", "release"]);
	});

	test("what is not a PermissionRequest hook input is refused", async () => {
		const rig = serve({ handler: async () => ({ behavior: "allow" }) });
		expect((await rig.post("{not json")).status).toBe(400);
		expect((await rig.post({ ...INPUT, hook_event_name: "PreToolUse" })).status).toBe(400);
		expect((await rig.post({ ...INPUT, session_id: "../../etc" })).status).toBe(400);
		expect((await rig.post({ ...INPUT, tool_name: "" })).status).toBe(400);
		expect((await rig.post([])).status).toBe(400);
		expect((await fetch(rig.url, { method: "GET", tls: { ca: undefined, rejectUnauthorized: false } })).status).toBe(
			405,
		);
		expect(rig.calls).toEqual([]);
	});

	test("a body past the bound is refused without being buffered", async () => {
		const rig = serve({ handler: async () => ({ behavior: "allow" }) });
		const huge = `{"pad":"${"x".repeat(9 * 1_048_576)}"}`;
		expect((await rig.post(huge)).status).toBe(413);
		expect(rig.calls).toEqual([]);
	});

	test("too many asks open at once are refused, and the ones open are not disturbed", async () => {
		const open: ((value: undefined) => void)[] = [];
		const rig = serve({ handler: () => new Promise((resolve) => open.push(resolve)) });
		const first = Array.from({ length: 64 }, () => rig.post(INPUT));
		for (let waited = 0; open.length < 64 && waited < 5_000; waited += 20) await Bun.sleep(20);
		expect(open).toHaveLength(64);
		expect((await rig.post(INPUT)).status).toBe(429);
		for (const resolve of open) resolve(undefined);
		for (const response of await Promise.all(first)) expect(await response.json()).toEqual({});
	});
});
