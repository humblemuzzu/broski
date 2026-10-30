/**
 * "Take over" (README owner decision 1, option d): a session another client wrote becomes one this bridge may drive
 * when the person says no terminal is using it. The adapter refuses while a terminal that runs the link extension
 * has the file open, and while the file changed a moment ago; otherwise it appends `broski.origin` and the session
 * is hosted, its viewers told by `session_replaced`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { RECENT_WRITE_MS } from "../../backends/pi/ops/take-over";
import { TerminalFeed } from "../../backends/pi/terminal/feed";
import type { TerminalSession } from "../../backends/pi/terminal/registry";
import { type BackendCallResult, type SessionRef, sessionCapabilities } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { say } from "./helpers/scenarios";
import { conversation, readEntries, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const LONG_AGO = new Date(Date.now() - 60 * 60 * 1000);

function terminalSession(rig: LiveRig, id: string, quiet = true): { ref: SessionRef; path: string } {
	const path = writeSessionFile(
		rig.world.sessionsRoot,
		{ id, cwd: rig.cwd, version: 3 },
		conversation(["from the terminal", "terminal answer"]),
	);
	if (quiet) utimesSync(path, LONG_AGO, LONG_AGO);
	return { ref: { backend: "pi", sessionId: id }, path };
}

function fakeTerminal(sessionPath: string, pid: number): TerminalSession {
	return {
		pid,
		sessionPath,
		sessionId: "terminal-3",
		feed: new TerminalFeed(Date.now, () => {}),
		command: async () => ({ ok: false, code: "backend_error", message: "this terminal is a fake" }),
	};
}

function takeOver(rig: LiveRig, sessionId: string): Promise<BackendCallResult | undefined> {
	return Promise.resolve(rig.backend.call?.({ backend: "pi", op: { kind: "take_over", sessionId } }));
}

function rejection(result: BackendCallResult | undefined): string {
	if (result?.status !== "rejected") throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
	return `${result.rejection.code}: ${result.rejection.message}`;
}

describe("taking over a session another client wrote", () => {
	test("marks the file, hosts the session, tells its viewers, and the session answers a prompt", async () => {
		t = await LiveRig.create();
		const { ref, path } = terminalSession(t, "terminal-1");
		const lastBefore = readEntries(path).at(-1);
		const opened = await t.rig.open(ref);
		expect(sessionCapabilities(opened.session)).toEqual({
			controllable: false,
			compact: false,
			cancelQueued: false,
			cancelCompaction: false,
			cancelRetry: false,
		});

		const result = await takeOver(t, ref.sessionId);
		expect(result).toEqual({ status: "accepted", result: { kind: "take_over" } });

		const replaced = await opened.waitFor("session_replaced");
		expect(replaced.session).toEqual(ref);
		expect(sessionCapabilities(opened.session)).toEqual({
			controllable: true,
			compact: true,
			cancelQueued: false,
			cancelCompaction: true,
			cancelRetry: true,
		});
		const marks = readEntries(path).filter((entry) => entry.type === "custom" && entry.customType === "broski.origin");
		expect(marks).toHaveLength(1);
		expect(marks[0]).toMatchObject({ type: "custom", parentId: (lastBefore as { id: string }).id });
		const summary = await t.backend.getSession(ref);
		expect(summary.status === "accepted" && summary.summary.origin).toBe("broski");

		t.router.script(ref.sessionId, [say("answer from the phone")]);
		const mark = opened.recorder.items.length;
		expect(await opened.prompt("continue it")).toEqual({ status: "accepted", disposition: "started" });
		expect((await opened.runAfter(mark)).outcome.kind).toBe("completed");
		await t.driver.quiesce();
		await opened.close();
	});

	test("a session nobody views is marked, and the next open hosts it", async () => {
		t = await LiveRig.create();
		const { ref, path } = terminalSession(t, "terminal-2");

		expect((await takeOver(t, ref.sessionId))?.status).toBe("accepted");
		expect(readEntries(path).some((entry) => entry.type === "custom" && entry.customType === "broski.origin")).toBe(
			true,
		);

		const opened = await t.rig.open(ref);
		expect(sessionCapabilities(opened.session).controllable).toBe(true);
		await opened.close();
	});

	test("is refused while a terminal pi has the file open, and writes nothing", async () => {
		t = await LiveRig.create();
		const { ref, path } = terminalSession(t, "terminal-3");
		const before = readFileSync(path);
		const gone = t.world.parts.terminal.registry.add(fakeTerminal(path, 4242));

		const refused = rejection(await takeOver(t, ref.sessionId));
		expect(refused).toStartWith("busy:");
		expect(refused).toContain("4242");
		expect(readFileSync(path).equals(before)).toBe(true);

		gone();
		expect((await takeOver(t, ref.sessionId))?.status).toBe("accepted");
	});

	test("is refused while the file changed a moment ago, and accepted once it has been quiet", async () => {
		t = await LiveRig.create();
		const { ref, path } = terminalSession(t, "terminal-4", false);
		const before = readFileSync(path);

		expect(rejection(await takeOver(t, ref.sessionId))).toStartWith("busy:");
		expect(readFileSync(path).equals(before)).toBe(true);

		const quietFor = new Date(Date.now() - RECENT_WRITE_MS - 1_000);
		utimesSync(path, quietFor, quietFor);
		expect((await takeOver(t, ref.sessionId))?.status).toBe("accepted");
	});

	test("is refused when the session's working directory is gone", async () => {
		t = await LiveRig.create();
		const missing = join(t.cwd, "removed-project");
		mkdirSync(missing);
		const path = writeSessionFile(
			t.world.sessionsRoot,
			{ id: "terminal-5", cwd: missing, version: 3 },
			conversation(["hello", "hi"]),
		);
		utimesSync(path, LONG_AGO, LONG_AGO);
		rmdirSync(missing);
		const before = readFileSync(path);

		expect(rejection(await takeOver(t, "terminal-5"))).toStartWith("not_found:");
		expect(readFileSync(path).equals(before)).toBe(true);
	});

	test("a session this bridge made is its own already: accepted, and nothing is written", async () => {
		t = await LiveRig.create();
		const created = await t.rig.openNew();
		await created.close();
		const path = t.fileOf(created.ref);
		const before = readFileSync(path);

		expect((await takeOver(t, created.ref.sessionId))?.status).toBe("accepted");
		expect(readFileSync(path).equals(before)).toBe(true);
	});

	test("an unknown session is not found", async () => {
		t = await LiveRig.create();
		expect(rejection(await takeOver(t, "no-such-session"))).toStartWith("not_found:");
	});

	test("a fork of a session another client wrote is still the bridge's, without a take over", async () => {
		t = await LiveRig.create();
		const { ref, path } = terminalSession(t, "terminal-6");
		const before = readFileSync(path);

		const forked = await t.backend.fork?.(ref, undefined);
		if (forked?.status !== "accepted") throw new Error("the fork was refused");
		const child = await t.backend.getSession(forked.session);
		expect(child.status === "accepted" && child.summary.origin).toBe("broski");
		expect(readFileSync(path).equals(before)).toBe(true);
		const continued = await t.rig.open(forked.session);
		expect(sessionCapabilities(continued.session).controllable).toBe(true);
		await continued.close();
	});
});
