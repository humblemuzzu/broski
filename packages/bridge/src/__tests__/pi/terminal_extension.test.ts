/**
 * The extension's own behaviour in a terminal: silent without a bridge, backing off while it is away, never letting its
 * buffer grow past a bound, and telling the user when the phone runs the session. The class under test is the one the
 * bridge installs; the bridge side is the real link server.
 */

import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { copyFileSync, mkdtempSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Link } from "../../backends/pi/terminal/extension/link";
import { KEY_FILE, SOCKET_FILE, TerminalLinkServer } from "../../backends/pi/terminal/link-server";
import { TerminalRegistry, type TerminalSession } from "../../backends/pi/terminal/registry";
import type { AgentEvent } from "../../contract";

const STREAM = (type: string, contentIndex: number, extra: object = {}) => ({
	e: "stream" as const,
	ev: { type, contentIndex, ...extra },
});

interface Terminal {
	readonly link: Link;
	readonly notices: string[];
	/** The titles the terminal's own `select` was asked, and what each answers. */
	readonly asked: string[];
	choose: (options: readonly string[]) => string | undefined;
	/** What was put back into the terminal's editor. */
	readonly editor: string[];
	ctx(mode?: string): ExtensionContext;
	/** Emits `event`, with Pi's idle flag as Pi keeps it: busy from a run's start until it settles. */
	emit(event: Parameters<Link["emit"]>[1]): void;
}

function terminal(): Terminal {
	const notices: string[] = [];
	const asked: string[] = [];
	const editor: string[] = [];
	let idle = true;
	const pi = { getThinkingLevel: () => "off", sendUserMessage: () => {} } as unknown as ExtensionAPI;
	const ctx = (mode = "tui"): ExtensionContext =>
		({
			mode,
			cwd: "/work",
			isIdle: () => idle,
			abort: () => {},
			model: undefined,
			ui: {
				notify: (text: string) => notices.push(text),
				select: async (title: string, options: string[]) => {
					asked.push(title);
					return shown.choose(options);
				},
				confirm: async () => false,
				input: async () => undefined,
				setEditorText: (text: string) => editor.push(text),
			},
			sessionManager: {
				getSessionFile: () => "/work/session.jsonl",
				getSessionId: () => "terminal-session",
				getSessionName: () => undefined,
				getLeafId: () => null,
			},
		}) as unknown as ExtensionContext;
	const link = new Link(pi);
	const shown: Terminal = {
		link,
		notices,
		asked,
		choose: () => undefined,
		editor,
		ctx,
		emit: (event) => {
			if (event.e === "agent_start") idle = false;
			if (event.e === "agent_settled") idle = true;
			link.emit(ctx(), event);
		},
	};
	return shown;
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
	return (await bridgeIn(directory, busy)).registry;
}

async function bridgeIn(
	where: string,
	busy = false,
): Promise<{ registry: TerminalRegistry; server: TerminalLinkServer; stop: () => Promise<void> }> {
	const registry = new TerminalRegistry();
	const server = new TerminalLinkServer({
		directory: where,
		registry,
		now: Date.now,
		busy: () => busy,
		changed: () => {},
	});
	await server.start();
	stops.push(() => server.stop());
	return { registry, server, stop: () => server.stop() };
}

/**
 * The extension's socket and key in `directory`, its connections passed on to a bridge in another directory, so a test
 * can break them while both ends live: `cut()` destroys every connection made so far.
 */
async function relayTo(bridgeDirectory: string): Promise<{ cut: () => void }> {
	copyFileSync(join(bridgeDirectory, KEY_FILE), join(directory, KEY_FILE));
	const pairs: Socket[][] = [];
	const relay = createServer((near) => {
		const far = createConnection(join(bridgeDirectory, SOCKET_FILE));
		near.on("error", () => far.destroy());
		far.on("error", () => near.destroy());
		near.pipe(far).pipe(near);
		pairs.push([near, far]);
	});
	const cut = () => {
		for (const pair of pairs.splice(0)) for (const socket of pair) socket.destroy();
	};
	await new Promise<void>((resolve) => relay.listen(join(directory, SOCKET_FILE), resolve));
	stops.push(() => {
		cut();
		return new Promise<void>((resolve) => relay.close(() => resolve()));
	});
	return { cut };
}

function viewed(session: TerminalSession): AgentEvent[] {
	const events: AgentEvent[] = [];
	session.feed.live.attach({ emit: (record) => events.push(record.event) });
	return events;
}

const blockTexts = (session: TerminalSession) => session.feed.snapshot().blocks.map((block) => block.text);
const toolNames = (session: TerminalSession) => session.feed.snapshot().tools.map((tool) => tool.name);

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
	const deadline = Date.now() + 4_000;
	while (!done()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await letGo();
	}
}

describe("without a bridge", () => {
	test("does nothing, says nothing, and throws nothing", async () => {
		const out = spyOn(process.stdout, "write");
		const err = spyOn(process.stderr, "write");
		const t = terminal();
		t.link.begin(t.ctx());
		t.emit({ e: "agent_start", leafId: null });
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

	test("tries again after 0.5, 1, 2 and 3 s, then every 5 s: a bridge back after a long outage is found within 5 s", async () => {
		jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] } as never);
		const t = terminal();
		t.link.begin(t.ctx());
		jest.advanceTimersByTime(60_000);
		const registry = await bridge();
		await letGo();
		jest.advanceTimersByTime(1_499);
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

	test("typing in a session the bridge runs asks in the terminal alone; kept, the text goes back; once the run ends, nothing is asked", async () => {
		const t = terminal();
		const { registry, server } = await bridgeIn(directory, true);
		const ctx = t.ctx();
		t.link.begin(ctx);
		const session = await held(registry);
		const phone = viewed(session);
		await until(() => t.notices.length > 0);

		t.choose = (options) => options[0];
		expect(await t.link.typed(ctx, "what happened?")).toEqual({ action: "handled" });
		expect(t.asked).toHaveLength(1);
		expect(t.asked[0]).toContain("split it in two");
		expect(t.editor).toEqual(["what happened?"]);

		t.choose = (options) => options[1];
		expect(await t.link.typed(ctx, "send it")).toEqual({ action: "continue" });
		expect(phone.some((event) => event.type === "interaction_requested")).toBe(false);

		server.hosted("terminal-session", false);
		await until(() => Reflect.get(t.link, "phoneRunning") === false);
		expect(await t.link.typed(ctx, "now it is mine")).toEqual({ action: "continue" });
		expect(t.asked).toHaveLength(2);
		t.link.end("quit");
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

		t.emit({ e: "agent_start", leafId: null });
		t.emit(STREAM("text_start", 0));
		t.emit({ e: "tool_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } });
		const chunk = "x".repeat(60_000);
		for (let i = 0; i < 80; i++) t.emit(STREAM("text_delta", 0, { delta: chunk }));
		await until(() => session.feed.snapshot().tools.length > 0);

		expect(session.feed.snapshot().run).toBeDefined();
		expect(session.feed.snapshot().tools.map((tool) => tool.name)).toEqual(["bash"]);

		t.emit({ e: "agent_settled", aborted: false });
		await until(() => session.feed.snapshot().run === undefined);
		t.link.end("quit");
	});
});

describe("a bridge that goes away and comes back", () => {
	test("a run that started while it was away is running when it is back, with its text and its tool", async () => {
		const t = terminal();
		t.link.begin(t.ctx());
		t.emit({ e: "agent_start", leafId: null });
		t.emit(STREAM("text_start", 0));
		t.emit(STREAM("text_delta", 0, { delta: "Hel" }));
		t.emit(STREAM("text_delta", 0, { delta: "lo" }));
		t.emit({ e: "tool_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } });

		const session = await held(await bridge());
		expect(session.feed.snapshot().run).toBeDefined();
		expect(blockTexts(session)).toEqual(["Hello"]);
		expect(toolNames(session)).toEqual(["bash"]);

		t.emit({ e: "agent_settled", aborted: false });
		await until(() => session.feed.snapshot().run === undefined);
		t.link.end("quit");
	});

	test("a run that ended while it was away is not running when it is back", async () => {
		const first = await bridgeIn(directory);
		const t = terminal();
		t.link.begin(t.ctx());
		const before = await held(first.registry);
		t.emit({ e: "agent_start", leafId: null });
		t.emit({ e: "tool_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } });
		await until(() => toolNames(before).length === 1);
		await first.stop();

		t.emit({ e: "tool_end", toolCallId: "call-1", toolName: "bash", result: {}, isError: false });
		t.emit({ e: "agent_settled", aborted: false });
		const after = await held(await bridge());
		expect(after.feed.snapshot().run).toBeUndefined();
		expect(after.feed.row().status).toBe("idle");
		t.link.end("quit");
	});
});

describe("a link that breaks while both ends live", () => {
	test("the phone sees no abort, and the run goes on from what happened meanwhile", async () => {
		const bridgeDirectory = mkdtempSync(join(tmpdir(), "broski-link-far-"));
		const { registry } = await bridgeIn(bridgeDirectory);
		const relay = await relayTo(bridgeDirectory);
		const t = terminal();
		t.link.begin(t.ctx());
		const session = await held(registry);
		const events = viewed(session);
		t.emit({ e: "agent_start", leafId: null });
		t.emit(STREAM("text_start", 0));
		t.emit(STREAM("text_delta", 0, { delta: "Hel" }));
		t.emit({ e: "tool_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } });
		await until(() => toolNames(session).length === 1 && blockTexts(session).join("") === "Hel");
		const runId = session.feed.snapshot().run?.runId;

		relay.cut();
		t.emit(STREAM("text_delta", 0, { delta: "lo" }));
		t.emit({ e: "tool_start", toolCallId: "call-2", toolName: "read", args: { path: "README.md" } });
		await until(() => toolNames(session).includes("read"));

		expect(registry.session("/work/session.jsonl")).toBe(session);
		expect(session.feed.snapshot().run?.runId).toBe(runId);
		expect(blockTexts(session)).toEqual(["Hello"]);
		expect(toolNames(session)).toEqual(["bash", "read"]);
		expect(events.some((event) => event.type === "run_finished" || event.type === "notice")).toBe(false);

		t.emit({ e: "agent_settled", aborted: false });
		await until(() => events.some((event) => event.type === "run_finished"));
		expect(events.at(-1)).toMatchObject({ type: "run_finished", runId, outcome: { kind: "completed" } });
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
		t.emit({ e: "agent_start", leafId: null });
		await letGo();
		await letGo();

		const rounds = 40;
		const size = 400_000;
		for (let round = 0; round < rounds; round++) {
			t.emit(STREAM("text_delta", 0, { delta: String(round).padStart(3, "0").padEnd(size, "y") }));
			if (round % 4 === 3) await letGo();
		}
		t.emit(STREAM("text_delta", 0, { delta: String(rounds).padStart(3, "0") }));
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
