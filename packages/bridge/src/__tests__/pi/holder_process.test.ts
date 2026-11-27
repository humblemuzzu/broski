/**
 * A holder over a real unix socket and a fake `pi` (`helpers/fake-pi.ts`): what a bridge that attaches is told, the
 * newest bridge winning, a half-sent line dropped with its bridge, `pi` read without pause whatever the bridge does,
 * the shutdown ladder, a `pi` that cannot start, a holder killed outright, and how long it keeps an unattached `pi`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { MAX_RECORD_BYTES } from "../../adapter-kit/jsonl";
import { Holder } from "../../backends/pi/holder/holder";
import { HolderLink } from "../../backends/pi/holder/link";
import { ORPHAN_LIMITS } from "../../backends/pi/holder/orphan-policy";
import { HOLDER_SUBCOMMAND, metaOf, socketOf } from "../../backends/pi/holder/protocol";
import { attachHolder } from "../../backends/pi/live/host-starts";
import type { TransportItem } from "../../backends/pi/rpc/transport";
import { eventually, FakeClock, type HolderWorld, holderWorld, isAlive, RawClient } from "./helpers/holder-rig";
import { HOLDER_COMMAND } from "./helpers/pi-world";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let world: HolderWorld | undefined;
const holders: Holder[] = [];
const clients: RawClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const holder of holders.splice(0)) {
		holder.stop();
		await holder.done;
	}
	world?.dispose();
	world = undefined;
});

async function started(start: readonly unknown[] = [], options: { clock?: FakeClock; cliPath?: string } = {}) {
	world = holderWorld();
	const holder = new Holder({
		dir: world.dir,
		spec: world.spec(start, options.cliPath),
		...(options.clock && { clock: options.clock }),
		backlog: { soft: 1024 * 1024, hard: 64 * 1024 * 1024, graceMs: 1_000 },
		watchMs: 50,
	});
	holders.push(holder);
	await holder.start();
	if (options.cliPath !== undefined) return { world, holder };
	await eventually(() => world?.piPid() !== 0, "pi to write its start records");
	await Bun.sleep(50);
	return { world, holder };
}

async function attach(dir: string): Promise<RawClient> {
	const client = await RawClient.connect(dir);
	clients.push(client);
	await client.untilRecord((record) => record.holder === "live", "the end of the replay");
	return client;
}

const emit = (...lines: unknown[]) => `${JSON.stringify({ type: "emit", lines })}\n`;
const settled = { type: "agent_settled", aborted: false };

describe("a bridge that attaches", () => {
	test("is told hello, what pi said since the session was last at rest, live, then pi's records as they come", async () => {
		const { world } = await started([{ type: "agent_start" }, settled, { type: "agent_start" }]);
		const first = await attach(world.dir);
		expect(first.records()[0]).toMatchObject({ holder: "hello", sessionId: world.sessionId, replayed: 1 });
		expect(first.replay()).toEqual([{ type: "agent_start" }]);
		first.send(emit({ type: "tool_execution_start", toolCallId: "t1" }));
		await first.untilRecord((record) => record.type === "tool_execution_start", "the live record");
		first.close();

		const second = await attach(world.dir);
		expect(second.records()[0]).toMatchObject({ holder: "hello", replayed: 2, truncated: false });
		expect(second.replay().map((record) => record.type)).toEqual(["agent_start", "tool_execution_start"]);
	});

	test("replaces the one before it, which is told so and is detached, not ended", async () => {
		const { world } = await started();
		const attached = await HolderLink.connect(world.dir);
		if (typeof attached === "string") throw new Error(`no holder answered: ${attached}`);
		const items: TransportItem[] = [];
		attached.link.start((item) => items.push(item));
		const second = await attach(world.dir);
		expect(await attached.link.ended).toEqual({ kind: "detached", replaced: true });
		expect(items).toEqual([
			{ kind: "replay", replaying: true },
			{ kind: "replay", replaying: false },
		]);
		second.send(emit({ type: "still_running" }));
		await second.untilRecord((record) => record.type === "still_running", "pi to answer the new bridge");
	});

	test("that goes mid-line leaves nothing of the line for pi: the next bridge's first command reaches pi whole", async () => {
		const { world } = await started();
		const dying = await attach(world.dir);
		dying.send('{"type":"emit","lines":[{"type":"never_sent"');
		await Bun.sleep(50);
		dying.close();
		await Bun.sleep(50);
		const next = await attach(world.dir);
		next.send(emit({ type: "whole" }));
		await next.untilRecord((record) => record.type === "whole", "the next bridge's command");
		expect(next.records().some((record) => record.type === "never_sent" || record.holder === "exit")).toBe(false);
	});

	test("answering an ask takes it out of what the next bridge is replayed", async () => {
		const asked = { type: "extension_ui_request", id: "q1", method: "confirm", title: "Go?", message: "" };
		const other = { type: "extension_ui_request", id: "q2", method: "confirm", title: "Stop?", message: "" };
		const { world } = await started([asked, other]);
		const first = await attach(world.dir);
		first.send(`${JSON.stringify({ type: "extension_ui_response", id: "q1", confirmed: true })}\n`);
		await first.untilRecord((record) => record.type === "echo", "pi to get the answer");
		first.close();
		const second = await attach(world.dir);
		const asks = second.replay().filter((record) => record.type === "extension_ui_request");
		expect(asks.map((record) => record.id)).toEqual(["q2"]);
	});
});

describe("pi", () => {
	test("is read without pause while its bridge reads nothing, and a bridge that stays behind is dropped", async () => {
		const { world } = await started();
		const stalled = await attach(world.dir);
		stalled.socket.pause();
		stalled.send(`${JSON.stringify({ type: "flood", count: 2_000, bytes: 4_096 })}\n`);
		await eventually(() => existsSync(join(world.piDir, "flooded")), "pi to write 8 MB nobody reads");
		await Bun.sleep(1_500);
		stalled.socket.resume();
		await stalled.until((client) => client.closed, "the stalled bridge to be dropped");
		const after = stalled.records().filter((record) => record.type === "flooded" || record.holder === "replaced");
		expect(after).toEqual([]);
		const next = await attach(world.dir);
		expect(next.replay().filter((record) => record.type === "message_update")).toHaveLength(2_000);
		expect(next.replay().at(-1)).toEqual({ type: "flooded" });
	});

	test("records each larger than the backlog bound all reach a bridge that keeps up, which stays attached", async () => {
		const { world } = await started();
		const reader = await attach(world.dir);
		reader.send(`${JSON.stringify({ type: "flood", count: 4, bytes: 3 * 1024 * 1024 })}\n`);
		await eventually(() => reader.closed || reader.lines.some((line) => line === '{"type":"flooded"}'), "the flood");
		expect(reader.closed).toBe(false);
		expect(reader.lines.filter((line) => line.startsWith('{"type":"message_update"'))).toHaveLength(4);
	});

	test("a run's agent_end past the record bound reaches its bridge as nothing; any other record as its size", async () => {
		const { world } = await started();
		const reader = await attach(world.dir);
		const big = (record: string) => `${JSON.stringify({ type: "big", record, bytes: MAX_RECORD_BYTES })}\n`;
		reader.send(big("agent_end"));
		await reader.untilRecord((record) => record.type === "big_done", "the agent_end to pass");
		expect(reader.records().filter((record) => record.holder === "oversized")).toEqual([]);
		reader.send(big("message_end"));
		await reader.until(
			(client) => client.records().filter((record) => record.type === "big_done").length === 2,
			"more",
		);
		expect(reader.records().filter((record) => record.holder === "oversized")).toEqual([
			{ holder: "oversized", bytes: MAX_RECORD_BYTES + '{"type":"message_end","filler":""}'.length },
		]);
	});

	test("asked to stop gets stdin's end and exits; the holder tells its bridge and removes its directory", async () => {
		const { world, holder } = await started();
		const client = await attach(world.dir);
		client.send('{"holder":"stop"}\n');
		await client.untilRecord((record) => record.holder === "exit", "the exit frame");
		expect(client.records().at(-1)).toMatchObject({ holder: "exit", code: 0, signal: null });
		await holder.done;
		expect(world.sawEof()).toBe(true);
		expect(existsSync(world.dir)).toBe(false);
	});

	test("asked to stop first answers the dialogs still open with Pi's default, as a bridge's own stop does", async () => {
		const ask = { type: "extension_ui_request", id: "q-open", method: "confirm", title: "Go?", message: "" };
		const { world, holder } = await started([ask]);
		const client = await attach(world.dir);
		client.send('{"holder":"stop"}\n');
		await client.untilRecord((record) => record.holder === "exit", "the exit frame");
		const echoes = client.records().filter((record) => record.type === "echo");
		expect(echoes.map((record) => JSON.parse(String(record.line)))).toEqual([
			{ type: "extension_ui_response", id: "q-open", cancelled: true },
		]);
		await holder.done;
	});

	test("that cannot start is an exit frame saying why, which begins a bridge's start as a failure", async () => {
		const { world, holder } = await started([], { cliPath: "/nonexistent/pi" });
		const client = await RawClient.connect(world.dir);
		clients.push(client);
		await client.untilRecord((record) => record.holder === "exit", "the exit frame");
		const exit = client.records().find((record) => record.holder === "exit");
		expect(typeof exit?.error === "string" || exit?.code !== 0).toBe(true);
		await holder.done;
	});

	test("whose holder is killed outright sees stdin end and exits", async () => {
		world = holderWorld();
		const launched = await HolderLink.launch({ root: world.holders, command: HOLDER_COMMAND }, world.spec());
		if (typeof launched === "string") throw new Error(launched);
		launched.link.start(() => undefined);
		await eventually(() => world?.piPid() !== 0, "pi to start");
		const meta = JSON.parse(readFileSync(metaOf(world.dir), "utf8"));
		const piPid = world.piPid();
		expect(JSON.parse(readFileSync(`${world.piDir}/argv`, "utf8"))).toEqual(["--mode", "rpc", ...world.spec().args]);
		process.kill(meta.pid, "SIGKILL");
		await eventually(() => world?.sawEof() === true, "pi to see stdin end");
		await eventually(() => !isAlive(piPid), "pi to exit");
		expect(await launched.link.ended).toEqual({ kind: "detached", replaced: false });
	});

	test("gets its environment over stdin: no secret of it is in the holder's argv or environment", async () => {
		world = holderWorld();
		const shim = join(world.root, "holder-shim");
		const [bun, main] = HOLDER_COMMAND;
		writeFileSync(
			shim,
			`#!/bin/sh\nenv > '${world.root}/holder-env'\nprintf '%s\\n' "$@" > '${world.root}/holder-argv'\nexec '${bun}' '${main}' "$@"\n`,
		);
		chmodSync(shim, 0o755);
		const launched = await HolderLink.launch({ root: world.holders, command: [shim, HOLDER_SUBCOMMAND] }, world.spec());
		if (typeof launched === "string") throw new Error(launched);
		launched.link.start(() => undefined);
		await eventually(() => world?.piPid() !== 0, "pi to start");
		const secret = world.spec().env.FAKE_SECRET ?? "";
		expect(readFileSync(join(world.piDir, "secret"), "utf8")).toBe(secret);
		expect(readFileSync(join(world.root, "holder-argv"), "utf8").split("\n")).toEqual([
			HOLDER_SUBCOMMAND,
			world.dir,
			"",
		]);
		expect(readFileSync(join(world.root, "holder-env"), "utf8")).not.toContain(secret);
		expect(readFileSync(metaOf(world.dir), "utf8")).not.toContain(secret);
		await launched.link.stop();
		expect(world.sawEof()).toBe(true);
	});

	test("is stopped when the holder's directory is removed", async () => {
		const { world, holder } = await started();
		rmSync(world.dir, { recursive: true, force: true });
		await holder.done;
		expect(world.sawEof()).toBe(true);
	});
});

describe("unattached, the holder keeps pi", () => {
	const minute = 60_000;

	async function orphaned(start: readonly unknown[]) {
		const clock = new FakeClock();
		const { world, holder } = await started(start, { clock });
		await eventually(() => world.piPid() !== 0, "pi to start");
		await Bun.sleep(100);
		return { clock, world, holder };
	}

	async function stoppedAfter(clock: FakeClock, world: HolderWorld, ms: number): Promise<boolean> {
		clock.advance(ms);
		await Bun.sleep(200);
		return world.sawEof();
	}

	test("idle, for ten minutes", async () => {
		const { clock, world } = await orphaned([]);
		expect(await stoppedAfter(clock, world, ORPHAN_LIMITS.idleMs - minute)).toBe(false);
		expect(await stoppedAfter(clock, world, minute)).toBe(true);
	});

	test("running, for hours", async () => {
		const { clock, world } = await orphaned([{ type: "agent_start" }]);
		expect(await stoppedAfter(clock, world, ORPHAN_LIMITS.idleMs)).toBe(false);
		expect(await stoppedAfter(clock, world, ORPHAN_LIMITS.runningMs - ORPHAN_LIMITS.idleMs)).toBe(true);
	});

	test("asking a human, for a day", async () => {
		const ask = { type: "extension_ui_request", id: "q", method: "confirm", title: "Go?", message: "" };
		const { clock, world } = await orphaned([{ type: "agent_start" }, ask]);
		expect(await stoppedAfter(clock, world, ORPHAN_LIMITS.runningMs)).toBe(false);
		expect(await stoppedAfter(clock, world, ORPHAN_LIMITS.askingMs - ORPHAN_LIMITS.runningMs)).toBe(true);
	});

	test("while a bridge is attached, for as long as it stays", async () => {
		const { clock, world } = await orphaned([]);
		await attach(world.dir);
		expect(await stoppedAfter(clock, world, ORPHAN_LIMITS.askingMs * 2)).toBe(false);
	});
});

describe("a holder that does not greet", () => {
	test("keeps its directory and refuses the session, so no second pi is started on its file", async () => {
		world = holderWorld();
		mkdirSync(world.dir, { recursive: true });
		const mute = createServer(() => undefined);
		await new Promise<void>((resolve) => mute.listen(socketOf(world?.dir ?? ""), resolve));
		try {
			const attached = await attachHolder({ root: world.holders, command: HOLDER_COMMAND }, world.sessionId);
			expect(attached !== undefined && "status" in attached && attached.rejection.code).toBe("busy");
			expect(existsSync(world.dir)).toBe(true);
		} finally {
			mute.close();
		}
	});

	test("a directory nothing listens in is left over and goes", async () => {
		world = holderWorld();
		mkdirSync(world.dir, { recursive: true });
		writeFileSync(socketOf(world.dir), "");
		expect(await attachHolder({ root: world.holders, command: HOLDER_COMMAND }, world.sessionId)).toBeUndefined();
		expect(existsSync(world.dir)).toBe(false);
	});
});
