/**
 * A terminal's link that breaks and comes back, and one that connects mid-run: the run, its tools and its dialogs are
 * picked up where they are, and only a terminal that is gone ends its run.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import { KEY_FILE, TerminalLinkServer } from "../../backends/pi/terminal/link-server";
import { TerminalRegistry, type TerminalSession } from "../../backends/pi/terminal/registry";
import { type AgentEvent, sessionStatus } from "../../contract";
import { type Client, deadPid, dial as dialWith, directoryOf, hello, linked, STATE } from "./helpers/link-client";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";
import { until } from "./host_rig";

useWatchdog();

let t: LiveRig | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
	for (const socket of sockets.splice(0)) socket.destroy();
	await t?.dispose();
	t = undefined;
});

const dial = (directory: string): Promise<Client> => dialWith(directory, sockets);

describe("a terminal that connects mid-run with a dialog open", () => {
	test("raises the dialog in the run, so the session waits for its user", async () => {
		t = await LiveRig.create({ link: true });
		const client = await dial(directoryOf(t));
		const dialog = { method: "confirm", title: "Allow it?", message: "rm -rf build" };
		const { session } = await linked(t, client, { ...STATE, running: true, dialogs: [{ id: "d-1", dialog }] });

		const snapshot = session.feed.snapshot();
		expect(snapshot.run).toBeDefined();
		expect(snapshot.interactions).toHaveLength(1);
		expect(snapshot.interactions[0]).toMatchObject({ title: "Allow it?", blocksRun: true });
		expect(snapshot.interactions[0]?.runId).toBe(snapshot.run?.runId);
		expect(sessionStatus(snapshot)).toBe("waiting_for_user");
		expect(session.feed.row().status).toBe("waiting_for_user");
	});
});

describe("a terminal whose connection drops while its pi lives", () => {
	test("keeps its run and its place: no abort, no flip to watch-only, and its next connection goes on", async () => {
		t = await LiveRig.create({ link: true });
		const registry = t.world.parts.terminal.registry;
		const first = await dial(directoryOf(t));
		const tool = { id: "call-1", name: "bash", args: { command: "sleep 30" } };
		const { session, events } = await linked(t, first, STATE);
		const file = session.sessionPath;
		const seen: (TerminalSession | undefined)[] = [];
		registry.watch(file, (held) => seen.push(held));
		first.send({ t: "event", event: { e: "agent_start", leafId: null } });
		first.send({
			t: "event",
			event: { e: "tool_start", toolCallId: tool.id, toolName: tool.name, args: tool.args },
		});
		await until(() => session.feed.snapshot().tools.length === 1, "the tool to start");
		const runId = session.feed.snapshot().run?.runId;

		first.socket.destroy();
		await Bun.sleep(600);
		expect(events.some((event) => event.type === "run_finished" || event.type === "notice")).toBe(false);
		expect(registry.session(file)).toBe(session);
		expect(await session.command({ kind: "abort" })).toMatchObject({ ok: false, code: "busy" });

		const second = await dial(directoryOf(t));
		second.send(hello(t, { pid: process.pid }, file));
		await second.next();
		const model = { provider: "p", id: "m", images: false };
		second.send({ t: "snapshot", reason: "connect", state: { ...STATE, running: true, tools: [tool], model } });
		await until(() => events.some((event) => event.type === "model_changed"), "the snapshot to be taken", 2_000);
		const answer = session.command({ kind: "abort" });
		expect(await second.next()).toMatchObject({ t: "command", command: { kind: "abort" } });
		second.send({ t: "result", id: "1", answer: { ok: true, disposition: "stopped" } });
		expect(await answer).toEqual({ ok: true, disposition: "stopped" });
		expect(registry.session(file)).toBe(session);
		expect(session.feed.snapshot().run?.runId).toBe(runId);
		expect(session.feed.snapshot().tools.map((open) => open.name)).toEqual(["bash"]);
		expect(events.some((event) => event.type === "tool_finished" || event.type === "run_finished")).toBe(false);

		second.send({ t: "event", event: { e: "agent_settled", aborted: true } });
		await until(() => events.some((event) => event.type === "run_finished"), "the run to end");
		expect(events.at(-1)).toMatchObject({ type: "run_finished", runId, outcome: { kind: "aborted" } });
		expect(seen).toEqual([]);
	});

	test("a call the model was still writing when the link dropped starts and finishes once", async () => {
		t = await LiveRig.create({ link: true });
		const first = await dial(directoryOf(t));
		const { session, events } = await linked(t, first, STATE);
		const call = { toolCallId: "call-9", toolName: "write", args: { path: "a.txt" } };
		first.send({ t: "event", event: { e: "agent_start", leafId: null } });
		first.send({ t: "event", event: { e: "message_start", role: "assistant" } });
		first.send({
			t: "event",
			event: { e: "stream", ev: { type: "toolcall_start", contentIndex: 0, id: call.toolCallId, toolName: "write" } },
		});
		await until(() => events.some((event) => event.type === "tool_started"), "the call to be announced");

		first.socket.destroy();
		await Bun.sleep(300);
		const second = await dial(directoryOf(t));
		second.send(hello(t, { pid: process.pid }, session.sessionPath));
		await second.next();
		const model = { provider: "p", id: "m", images: false };
		second.send({ t: "snapshot", reason: "connect", state: { ...STATE, running: true, model } });
		await until(() => events.some((event) => event.type === "model_changed"), "the snapshot to be taken", 2_000);
		second.send({ t: "event", event: { e: "tool_start", ...call } });
		const { args: _args, ...ended } = call;
		second.send({ t: "event", event: { e: "tool_end", ...ended, result: { content: [] }, isError: false } });
		second.send({ t: "event", event: { e: "agent_settled", aborted: false } });
		await until(() => events.some((event) => event.type === "run_finished"), "the run to end");

		expect(events.filter((event) => event.type === "tool_started")).toHaveLength(1);
		const finished = events.filter((event) => event.type === "tool_finished");
		expect(finished).toHaveLength(1);
		expect(finished[0]).toMatchObject({ outcome: "completed" });
	});

	test("a terminal that never dials again is let go after the wait, its run ended aborted", async () => {
		t = await LiveRig.create({ link: true });
		const directory = join(t.world.env.root, "grace");
		const registry = new TerminalRegistry();
		const server = new TerminalLinkServer({
			directory,
			registry,
			now: Date.now,
			busy: () => false,
			changed: () => {},
			graceMs: 300,
		});
		await server.start();
		try {
			const client = await dial(directory);
			const file = join(t.world.env.sessionDir, "x.jsonl");
			const key = readFileSync(join(directory, KEY_FILE), "utf8");
			client.send(hello(t, { pid: process.pid, key }, file));
			await client.next();
			client.send({ t: "snapshot", reason: "connect", state: { ...STATE, running: true } });
			await until(() => registry.session(file) !== undefined, "the terminal to be held");
			const events: AgentEvent[] = [];
			registry.session(file)?.feed.live.attach({ emit: (record) => events.push(record.event) });

			client.socket.destroy();
			await Bun.sleep(100);
			expect(registry.session(file)).toBeDefined();
			await until(() => registry.session(file) === undefined, "the terminal to be let go", 2_000);
			expect(events.at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		} finally {
			await server.stop();
		}
	});
});

describe("a terminal that disappears", () => {
	test("mid-run, its process gone without a word, ends its run aborted with a notice, for the viewers that were watching", async () => {
		t = await LiveRig.create({ link: true });
		const client = await dial(directoryOf(t));
		const { events } = await linked(t, client, STATE, await deadPid());
		client.send({ t: "event", event: { e: "agent_start", leafId: null } });
		await until(() => events.some((event) => event.type === "run_started"), "the run to start");

		client.socket.destroy();
		await until(() => events.some((event) => event.type === "run_finished"), "the run to end", 1_000);

		expect(events.at(-2)).toEqual({
			type: "notice",
			level: "warning",
			text: "The terminal closed while this was running.",
		});
		expect(events.at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
	});
});
