/**
 * The extension's own behaviour in a terminal: silent without a bridge, backing off while it is away, never letting its
 * buffer grow past a bound, and telling the user when the phone runs the session. The class under test is the one the
 * bridge installs; the bridge side is the real link server.
 */

import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Link } from "../../backends/pi/terminal/extension/link";
import { KEY_FILE, SOCKET_FILE, TerminalLinkServer } from "../../backends/pi/terminal/link-server";
import { TerminalRegistry, type TerminalSession } from "../../backends/pi/terminal/registry";

const STREAM = (type: string, contentIndex: number, extra: object = {}) => ({
	e: "stream" as const,
	ev: { type, contentIndex, ...extra },
});

interface Terminal {
	readonly link: Link;
	readonly notices: string[];
	ctx(mode?: string): ExtensionContext;
}

function terminal(): Terminal {
	const notices: string[] = [];
	const pi = { getThinkingLevel: () => "off", sendUserMessage: () => {} } as unknown as ExtensionAPI;
	const ctx = (mode = "tui"): ExtensionContext =>
		({
			mode,
			cwd: "/work",
			isIdle: () => true,
			abort: () => {},
			model: undefined,
			ui: { notify: (text: string) => notices.push(text) },
			sessionManager: {
				getSessionFile: () => "/work/session.jsonl",
				getSessionId: () => "terminal-session",
				getSessionName: () => undefined,
				getLeafId: () => null,
			},
		}) as unknown as ExtensionContext;
	return { link: new Link(pi), notices, ctx };
}

let directory: string;
let saved: string | undefined;
const stops: (() => void | Promise<void>)[] = [];

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "broski-link-ext-"));
	saved = process.env.BROSKI_PI_LINK_DIR;
	process.env.BROSKI_PI_LINK_DIR = directory;
});

afterEach(async () => {
	jest.useRealTimers();
	if (saved === undefined) delete process.env.BROSKI_PI_LINK_DIR;
	else process.env.BROSKI_PI_LINK_DIR = saved;
	for (const stop of stops.splice(0).reverse()) await stop();
});

async function bridge(busy = false): Promise<TerminalRegistry> {
	const registry = new TerminalRegistry();
	const server = new TerminalLinkServer({ directory, registry, now: Date.now, busy: () => busy, changed: () => {} });
	await server.start();
	stops.push(() => server.stop());
	return registry;
}

function held(registry: TerminalRegistry): Promise<TerminalSession> {
	const path = "/work/session.jsonl";
	const present = registry.session(path);
	if (present) return Promise.resolve(present);
	return new Promise((resolve) => {
		const stop = registry.watch(path, (session) => {
			if (!session) return;
			stop();
			resolve(session);
		});
	});
}

const letGo = () => new Promise<void>((resolve) => setImmediate(resolve));

async function until(done: () => boolean): Promise<void> {
	while (!done()) await letGo();
}

describe("without a bridge", () => {
	test("does nothing, says nothing, and throws nothing", async () => {
		const out = spyOn(process.stdout, "write");
		const err = spyOn(process.stderr, "write");
		const t = terminal();
		t.link.begin(t.ctx());
		t.link.emit(t.ctx(), { e: "agent_start", leafId: null });
		t.link.end("quit");
		await letGo();
		expect(out).not.toHaveBeenCalled();
		expect(err).not.toHaveBeenCalled();
		expect(t.notices).toEqual([]);
		out.mockRestore();
		err.mockRestore();
	});

	test("does not connect in a mode that is not the interactive terminal", async () => {
		const registry = await bridge();
		const t = terminal();
		t.link.begin(t.ctx("rpc"));
		await letGo();
		await letGo();
		expect(registry.session("/work/session.jsonl")).toBeUndefined();
		t.link.end("quit");
	});

	test("tries again after 1 s, then 2 s, then 5 s, and connects when the bridge appears", async () => {
		jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] } as never);
		const t = terminal();
		t.link.begin(t.ctx());
		jest.advanceTimersByTime(1_000);
		jest.advanceTimersByTime(2_000);
		const registry = await bridge();
		await letGo();
		jest.advanceTimersByTime(4_999);
		await letGo();
		await letGo();
		expect(registry.session("/work/session.jsonl")).toBeUndefined();
		jest.advanceTimersByTime(1);
		await held(registry);
		t.link.end("quit");
	});
});

describe("with a bridge", () => {
	test("a session the bridge is running gets one warning, a quiet one none", async () => {
		const running = terminal();
		const registry = await bridge(true);
		running.link.begin(running.ctx());
		await held(registry);
		await until(() => running.notices.length > 0);
		expect(running.notices).toHaveLength(1);
		expect(running.notices[0]).toContain("phone");
		running.link.end("quit");
	});

	test("a session nobody runs here gets no warning", async () => {
		const quiet = terminal();
		const registry = await bridge(false);
		quiet.link.begin(quiet.ctx());
		await held(registry);
		await letGo();
		expect(quiet.notices).toEqual([]);
		quiet.link.end("quit");
	});

	test("events lost to a full buffer are replaced by a snapshot, and the bridge goes on from it", async () => {
		const registry = await bridge();
		const t = terminal();
		const ctx = t.ctx();
		t.link.begin(ctx);
		const session = await held(registry);

		t.link.emit(ctx, { e: "agent_start", leafId: null });
		t.link.emit(ctx, STREAM("text_start", 0));
		t.link.emit(ctx, { e: "tool_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } });
		const chunk = "x".repeat(60_000);
		for (let i = 0; i < 80; i++) t.link.emit(ctx, STREAM("text_delta", 0, { delta: chunk }));
		await until(() => session.feed.snapshot().tools.length > 0);

		expect(session.feed.snapshot().run).toBeDefined();
		expect(session.feed.snapshot().tools.map((tool) => tool.name)).toEqual(["bash"]);

		t.link.emit(ctx, { e: "agent_settled", aborted: false });
		await until(() => session.feed.snapshot().run === undefined);
		t.link.end("quit");
	});
});

describe("a bridge that stops reading", () => {
	let server: Server;
	let peer: Socket | undefined;
	let received = 0;
	const order: (number | "resync")[] = [];

	function take(line: string): void {
		const frame = JSON.parse(line);
		if (frame.t === "snapshot" && frame.reason === "resync") order.push("resync");
		const delta = frame.event?.ev?.delta;
		if (typeof delta === "string") order.push(Number(delta.slice(0, 3)));
	}

	beforeEach(async () => {
		received = 0;
		order.length = 0;
		peer = undefined;
		server = createServer((socket) => {
			peer = socket;
			socket.setEncoding("utf8");
			let greeted = false;
			let pending = "";
			socket.on("data", (data: string) => {
				received += data.length;
				pending += data;
				for (let end = pending.indexOf("\n"); end !== -1; end = pending.indexOf("\n")) {
					take(pending.slice(0, end));
					pending = pending.slice(end + 1);
				}
				if (greeted) return;
				greeted = true;
				socket.write(`${JSON.stringify({ t: "welcome", running: false })}\n`);
				socket.pause();
			});
			socket.on("error", () => {});
		});
		await new Promise<void>((resolve) => server.listen(join(directory, SOCKET_FILE), resolve));
		stops.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
		await Bun.write(join(directory, KEY_FILE), "k".repeat(64));
	});

	test("the buffer stays bounded, the surplus is dropped, and a snapshot comes before anything after the gap", async () => {
		const t = terminal();
		const ctx = t.ctx();
		t.link.begin(ctx);
		await until(() => peer !== undefined);
		t.link.emit(ctx, { e: "agent_start", leafId: null });
		await letGo();
		await letGo();

		const rounds = 40;
		const size = 400_000;
		for (let round = 0; round < rounds; round++) {
			t.link.emit(ctx, STREAM("text_delta", 0, { delta: String(round).padStart(3, "0").padEnd(size, "y") }));
			if (round % 4 === 3) await letGo();
		}
		t.link.emit(ctx, STREAM("text_delta", 0, { delta: String(rounds).padStart(3, "0") }));
		await letGo();
		peer?.resume();
		await until(() => order.includes("resync"));

		const before = order.slice(0, order.indexOf("resync"));
		expect(before).toEqual(before.map((_, index) => index));
		expect(before.length).toBeLessThan(rounds);
		expect(received).toBeLessThan(rounds * size);
		t.link.end("quit");
	});
});
