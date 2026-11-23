/** The socket terminal `pi` processes talk to the bridge over: who may use it, what it accepts, and what it never lets through. */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import { terminalControl } from "../../backends/pi/terminal/control";
import { KEY_FILE, SOCKET_FILE, TerminalLinkServer } from "../../backends/pi/terminal/link-server";
import { LINK_VERSION } from "../../backends/pi/terminal/protocol";
import { TerminalRegistry } from "../../backends/pi/terminal/registry";
import type { AgentEvent } from "../../contract";
import { type Client, dial as dialWith, directoryOf, hello, STATE } from "./helpers/link-client";
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

describe("who may use the socket", () => {
	test("only the user: the directory, the socket and the key are private", async () => {
		t = await LiveRig.create({ link: true });
		const directory = directoryOf(t);
		expect(statSync(directory).mode & 0o777).toBe(0o700);
		expect(statSync(join(directory, SOCKET_FILE)).mode & 0o777).toBe(0o600);
		expect(statSync(join(directory, KEY_FILE)).mode & 0o777).toBe(0o600);
		expect(statSync(join(directory, KEY_FILE)).size).toBe(64);
	});

	test("a connection that does not quote the key is closed before it is told anything", async () => {
		t = await LiveRig.create({ link: true });
		const client = await dial(directoryOf(t));
		client.send(hello(t, { key: "0".repeat(64) }));
		await client.closed;
		expect(client.lines).toEqual([]);
		expect(t.world.parts.terminal.registry.session(join(t.world.env.sessionDir, "x.jsonl"))).toBeUndefined();
	});

	test("the right key is welcomed; the key changes at every start of the bridge", async () => {
		t = await LiveRig.create({ link: true });
		const client = await dial(directoryOf(t));
		client.send(hello(t));
		expect(await client.next()).toEqual({ t: "welcome", running: false });
		const before = readFileSync(join(directoryOf(t), KEY_FILE), "utf8");
		await t.world.restart({ catalog: t.catalog });
		const after = readFileSync(join(directoryOf(t), KEY_FILE), "utf8");
		expect(after).toHaveLength(64);
		expect(after).not.toBe(before);
	});
});

describe("what the bridge accepts from a terminal", () => {
	const broken: [string, (rig: LiveRig) => (object | string)[]][] = [
		["a line that is not JSON", () => ["{not json"]],
		["a frame it does not know", () => [{ t: "launch" }]],
		["a version it does not speak", (rig) => [hello(rig, { v: LINK_VERSION + 1 })]],
		["an event before the hello", () => [{ t: "event", event: { e: "agent_settled", aborted: false } }]],
		["a snapshot before the hello", () => [{ t: "snapshot", reason: "connect", state: STATE }]],
		[
			"a session file that is not an absolute path",
			(rig) => [hello(rig, { session: { file: "x.jsonl", id: "s", cwd: "/" } })],
		],
		["a second hello", (rig) => [hello(rig), hello(rig)]],
		[
			"an event before the snapshot",
			(rig) => [hello(rig), { t: "event", event: { e: "agent_settled", aborted: false } }],
		],
		[
			"an event with a field it does not have",
			(rig) => [
				hello(rig),
				{ t: "snapshot", reason: "connect", state: STATE },
				{ t: "event", event: { e: "agent_settled", aborted: false, extra: 1 } },
			],
		],
		[
			"an answer to a command nobody sent",
			(rig) => [
				hello(rig),
				{ t: "snapshot", reason: "connect", state: STATE },
				{ t: "result", id: "99", answer: { ok: true, disposition: "stopped" } },
			],
		],
	];
	for (const [what, frames] of broken) {
		test(`closes the connection on ${what}, and the terminal is no longer held`, async () => {
			t = await LiveRig.create({ link: true });
			const client = await dial(directoryOf(t));
			for (const frame of frames(t)) client.send(frame);
			await client.closed;
			expect(t.world.parts.terminal.registry.session(join(t.world.env.sessionDir, "x.jsonl"))).toBeUndefined();
		});
	}

	test("a line past the size limit closes the connection", async () => {
		t = await LiveRig.create({ link: true });
		const client = await dial(directoryOf(t));
		client.send(hello(t));
		await client.next();
		client.socket.write("x".repeat(9 * 1024 * 1024));
		await client.closed;
	});

	test("a well-formed terminal is held, hears commands, and is gone when it says bye", async () => {
		t = await LiveRig.create({ link: true });
		const file = join(t.world.env.sessionDir, "x.jsonl");
		writeFileSync(file, "");
		const client = await dial(directoryOf(t));
		client.send(hello(t, {}, file));
		await client.next();
		client.send({ t: "snapshot", reason: "connect", state: STATE });
		const session = await new Promise<NonNullable<ReturnType<TerminalRegistry["session"]>>>((resolve) => {
			const present = t?.world.parts.terminal.registry.session(file);
			if (present) return resolve(present);
			const stop = t?.world.parts.terminal.registry.watch(file, (held) => {
				if (!held) return;
				stop?.();
				resolve(held);
			});
		});
		expect(t.world.parts.terminal.registry.holder(file)).toMatchObject({ pid: 4321 });

		const answer = session.command({ kind: "abort" });
		expect(await client.next()).toMatchObject({ t: "command", command: { kind: "abort" } });
		client.send({ t: "result", id: "1", answer: { ok: true, disposition: "stopped" } });
		expect(await answer).toEqual({ ok: true, disposition: "stopped" });

		client.send({ t: "bye", reason: "quit" });
		await client.closed;
		expect(t.world.parts.terminal.registry.session(file)).toBeUndefined();
		expect(await session.command({ kind: "abort" })).toMatchObject({ ok: false, code: "backend_error" });
	});
});

describe("a terminal that loaded an older copy of the extension", () => {
	test("is held and followed: a snapshot with no tasks and a message with no type are what that copy sends", async () => {
		t = await LiveRig.create({ link: true });
		const file = join(t.world.env.sessionDir, "x.jsonl");
		writeFileSync(file, "");
		const client = await dial(directoryOf(t));
		client.send(hello(t, {}, file));
		expect(await client.next()).toMatchObject({ t: "welcome" });
		const { tasks: _tasks, ...before } = STATE;
		client.send({ t: "snapshot", reason: "connect", state: before });
		const registry = t.world.parts.terminal.registry;
		await until(() => registry.session(file) !== undefined, "the terminal to be held");
		const events: AgentEvent[] = [];
		registry.session(file)?.feed.live.attach({ emit: (record) => events.push(record.event) });
		client.send({ t: "event", event: { e: "message_end", message: { role: "custom", display: true, text: "Done." } } });
		await until(() => events.some((event) => event.type === "activity"), "the message to show");
		expect(events.find((event) => event.type === "activity")).toMatchObject({
			activity: { kind: "message", title: "Extension message", body: { format: "markdown", text: "Done." } },
		});
		expect(client.socket.destroyed).toBe(false);
	});

	test("pre-v10 extension does not advertise compact and refuses model/thinking without sending unknown commands", async () => {
		t = await LiveRig.create({ link: true });
		const file = join(t.world.env.sessionDir, "v9.jsonl");
		writeFileSync(file, "");
		const client = await dial(directoryOf(t));
		client.send(hello(t, { extension: "9" }, file));
		expect(await client.next()).toMatchObject({ t: "welcome" });
		client.send({ t: "snapshot", reason: "connect", state: STATE });
		const registry = t.world.parts.terminal.registry;
		await until(() => registry.session(file) !== undefined, "the v9 terminal to be held");
		const session = registry.session(file);
		if (!session) throw new Error("expected session");
		const control = terminalControl(session);
		expect(control.compact).toBeUndefined();
		expect(await control.setModel("scripted/scripted-plain")).toMatchObject({
			status: "rejected",
			rejection: { code: "unsupported" },
		});
		expect(await control.setThinking("high")).toMatchObject({
			status: "rejected",
			rejection: { code: "unsupported" },
		});
		expect(client.lines).toEqual([]);
	});
});

describe("starting the socket", () => {
	test("replaces the file a dead bridge left, and refuses to take it from a live one", async () => {
		t = await LiveRig.create({ link: true });
		const directory = join(t.world.env.root, "second");
		const options = {
			directory,
			registry: new TerminalRegistry(),
			now: Date.now,
			busy: () => false,
			changed: () => {},
		};
		const first = new TerminalLinkServer(options);
		await first.start();
		await expect(new TerminalLinkServer(options).start()).rejects.toThrow("already listens");
		await first.stop();
		writeFileSync(join(directory, SOCKET_FILE), "");
		const second = new TerminalLinkServer(options);
		await second.start();
		await second.stop();
	});
});
