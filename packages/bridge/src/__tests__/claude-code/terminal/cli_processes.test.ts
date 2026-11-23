/**
 * Adapter README D28: the CLI's register of running processes (`<configRoot>/sessions/<pid>.json`) says a terminal
 * holds a session however long its transcript has been quiet, and gives the session's status. The processes here are
 * real ones the test starts; the register files are written as CLI 2.1.325 writes them.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { processStart } from "../../../backends/claude-code/terminal/cli-processes";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { writeFixtureSession } from "../helpers/fixture-transcripts";
import { type TerminalRig, terminalRig } from "./rig";

let home: ClaudeHome | undefined;
let rig: TerminalRig | undefined;
const children: ReturnType<typeof Bun.spawn>[] = [];

afterEach(async () => {
	await rig?.watch.dispose();
	for (const child of children.splice(0)) child.kill();
	home?.cleanup();
	rig = undefined;
	home = undefined;
});

/** A session whose transcript nobody has written for a minute. */
function quietSession(claude: ClaudeHome): string {
	const sessionId = crypto.randomUUID();
	const path = writeFixtureSession(claude.configDir, { sessionId, cwd: claude.projectDir, prompts: ["hello"] });
	const minuteAgo = new Date(Date.now() - 60_000);
	utimesSync(path, minuteAgo, minuteAgo);
	return sessionId;
}

/** A process that lives until the test ends, standing in for a terminal `claude`. */
function running(): number {
	const child = Bun.spawn(["sleep", "120"]);
	children.push(child);
	return child.pid;
}

async function deadPid(): Promise<number> {
	const child = Bun.spawn(["true"]);
	await child.exited;
	return child.pid;
}

function registerFile(claude: ClaudeHome, pid: number): string {
	return join(claude.configDir, "sessions", `${pid}.json`);
}

/** The register entry the CLI writes for `pid`, `fields` over a terminal's defaults. */
async function register(claude: ClaudeHome, pid: number, sessionId: string, fields: object = {}): Promise<void> {
	mkdirSync(join(claude.configDir, "sessions"), { recursive: true });
	const entry = {
		pid,
		sessionId,
		cwd: claude.projectDir,
		startedAt: Date.now(),
		procStart: await processStart(pid),
		version: "2.1.325",
		kind: "interactive",
		entrypoint: "cli",
		status: "busy",
		updatedAt: Date.now(),
		statusUpdatedAt: Date.now(),
		...fields,
	};
	writeFileSync(registerFile(claude, pid), JSON.stringify(entry));
}

async function until(done: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!done()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
		await Bun.sleep(20);
	}
}

describe("a session a terminal claude holds", () => {
	test("reads as the terminal's however quiet its transcript, and as nobody's once the process is gone", async () => {
		home = createClaudeHome();
		rig = terminalRig(home);
		const sessionId = quietSession(home);
		expect(await rig.watch.writing(sessionId)).toBe(false);

		const pid = running();
		await register(home, pid, sessionId, { status: "idle" });
		expect(await rig.watch.writing(sessionId)).toBe(true);

		rig.hosted.add(sessionId);
		expect(await rig.watch.writing(sessionId)).toBe(false);
		rig.hosted.delete(sessionId);

		rmSync(registerFile(home, pid));
		expect(await rig.watch.writing(sessionId)).toBe(false);
	});

	test("an entry a dead process left, one whose pid now names another process, and an SDK's own are no terminal", async () => {
		home = createClaudeHome();
		rig = terminalRig(home);
		const sessionId = quietSession(home);

		await register(home, await deadPid(), sessionId, { procStart: undefined });
		expect(await rig.watch.writing(sessionId)).toBe(false);

		const reused = running();
		await register(home, reused, sessionId, { procStart: "Mon Jan  1 00:00:00 2001" });
		expect(await rig.watch.writing(sessionId)).toBe(false);

		await register(home, reused, sessionId, { entrypoint: "sdk-ts" });
		expect(await rig.watch.writing(sessionId)).toBe(false);

		await register(home, reused, sessionId);
		expect(await rig.watch.writing(sessionId)).toBe(true);
	});

	test("its status is the session's row, and every change of it is announced", async () => {
		home = createClaudeHome();
		rig = terminalRig(home);
		const watch = rig.watch;
		const announced = rig.announced;
		const sessionId = quietSession(home);
		await watch.start();
		expect(watch.row(sessionId)).toBeUndefined();

		const pid = running();
		await register(home, pid, sessionId, { status: "busy" });
		await until(() => watch.row(sessionId)?.status === "running", "the run shows");
		expect(announced).toContain(sessionId);

		const before = announced.length;
		await register(home, pid, sessionId, { status: "waiting" });
		await until(() => watch.row(sessionId)?.status === "waiting_for_user", "the wait shows");
		expect(announced.length).toBeGreaterThan(before);

		await register(home, pid, sessionId, { status: "idle" });
		await until(() => watch.row(sessionId)?.status === "idle", "the idle shows");

		rig.hosted.add(sessionId);
		expect(watch.row(sessionId)).toBeUndefined();
		rig.hosted.delete(sessionId);

		const announcedBeforeExit = announced.length;
		rmSync(registerFile(home, pid));
		await until(() => watch.row(sessionId) === undefined, "the process to be gone from the row");
		expect(announced.length).toBeGreaterThan(announcedBeforeExit);
	});

	test("a terminal that just exited clears writing() at once even when the transcript was written moments ago", async () => {
		home = createClaudeHome();
		rig = terminalRig(home);
		const watch = rig.watch;
		const sessionId = crypto.randomUUID();
		const path = writeFixtureSession(home.configDir, { sessionId, cwd: home.projectDir, prompts: ["fresh"] });
		await watch.start();

		const pid = running();
		await register(home, pid, sessionId, { status: "busy" });
		await until(() => watch.row(sessionId)?.status === "running", "the process to register");
		expect(await watch.writing(sessionId)).toBe(true);

		const now = new Date();
		utimesSync(path, now, now);
		rmSync(registerFile(home, pid));
		await until(() => watch.row(sessionId) === undefined, "the process to exit");
		expect(await watch.writing(sessionId)).toBe(false);
	});

	test("a process killed without removing its entry is seen gone by the sweep", async () => {
		home = createClaudeHome();
		rig = terminalRig(home);
		const watch = rig.watch;
		const sessionId = quietSession(home);
		await watch.start();
		const child = Bun.spawn(["sleep", "120"]);
		children.push(child);
		await register(home, child.pid, sessionId, { status: "busy" });
		await until(() => watch.row(sessionId)?.status === "running", "the run shows");

		child.kill("SIGKILL");
		await child.exited;
		await until(() => watch.row(sessionId) === undefined, "the sweep to see the process gone");
	});

	test("a CLI that keeps no register changes nothing: the transcript's age decides", async () => {
		home = createClaudeHome();
		rig = terminalRig(home);
		const sessionId = quietSession(home);
		await rig.watch.start();
		expect(await rig.watch.writing(sessionId)).toBe(false);
		expect(rig.watch.row(sessionId)).toBeUndefined();
	});
});
