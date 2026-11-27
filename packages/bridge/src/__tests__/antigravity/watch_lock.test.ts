/**
 * A session a terminal `agy` has open, as the bridge watches agy's presence lock while another real process takes and
 * lets go of a real `flock` on it (`platform/file-lock.ts`, standing in for the terminal): the view is watch-only while
 * the lock is held, promotes itself once it is free, goes back to watching when it is taken again, and is hosted on the
 * phone's first action. The bridge's own looks at the lock hold it no longer than the look: once the holders have gone,
 * the lock is anyone's.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PresenceLocks } from "../../backends/antigravity/live/lock";
import { openWatched, WATCHING_NOTICE } from "../../backends/antigravity/live/watch";
import { emptySnapshot, type OpenSession, type SessionRef, type SinkRecord, sessionCapabilities } from "../../contract";
import { fileLock } from "../../platform/file-lock";

const MODULE = join(import.meta.dir, "..", "..", "platform", "file-lock.ts");
const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function presenceDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-agy-presence-"));
	dirs.push(dir);
	return dir;
}

/** A `bun` that takes the lock as a terminal `agy` does, says so, and holds it until its stdin ends. */
async function terminal(path: string) {
	const script = `
		const { fileLock } = await import(${JSON.stringify(MODULE)});
		const held = fileLock.open(${JSON.stringify(path)}).tryLock();
		console.log(held ? "held" : "refused");
		for await (const _ of Bun.stdin.stream()) {}
		process.exit(0);
	`;
	const child = Bun.spawn([process.execPath, "-e", script], { stdin: "pipe", stdout: "pipe" });
	const first = new TextDecoder().decode((await child.stdout.getReader().read()).value).trim();
	return {
		first,
		quit: async () => {
			child.stdin.end();
			await child.exited;
		},
	};
}

async function until(condition: () => boolean): Promise<void> {
	for (let waited = 0; !condition(); waited += 10) {
		if (waited > 5_000) throw new Error("the view did not change within 5 s");
		await Bun.sleep(10);
	}
}

describe("a session a terminal agy holds", () => {
	test("is watched while the lock is held, promoted when it is let go, watched again, then hosted on a prompt", async () => {
		const dir = presenceDir();
		const ref: SessionRef = { backend: "antigravity", sessionId: crypto.randomUUID() };
		const path = join(dir, `${ref.sessionId}.lock`);
		const locks = new PresenceLocks(dir, fileLock);
		const first = await terminal(path);
		expect(first.first).toBe("held");
		expect(locks.heldElsewhere(ref.sessionId)).toBe(true);
		const records: SinkRecord[] = [];
		const prompts: string[] = [];
		const opened = await openWatched(
			{
				ref,
				terminalHolds: () => locks.heldElsewhere(ref.sessionId),
				locate: async () => ({}),
				openHosted: async () => hostedSession(ref, prompts),
				pollMs: 20,
				now: () => 1_000,
			},
			{},
			{ emit: (record) => records.push(record) },
		);
		if (opened.status !== "accepted") throw new Error(opened.rejection.message);
		const view = opened.session;
		const capabilities = () => sessionCapabilities(view);
		expect(capabilities()).toEqual({ controllable: false, compact: false, cancelQueued: false, answer: false });
		await until(() => records.some((record) => record.event.type === "notice"));
		expect(records.map((record) => record.event)).toEqual([{ type: "notice", level: "info", text: WATCHING_NOTICE }]);

		await first.quit();
		await until(() => capabilities().controllable);
		expect(capabilities()).toEqual({ controllable: true, compact: true, cancelQueued: false, answer: true });
		expect(records.slice(1).map((record) => record.event.type)).toEqual(["resynced", "session_replaced"]);

		const again = await terminal(path);
		expect(again.first).toBe("held");
		await until(() => !capabilities().controllable);
		await again.quit();
		await until(() => capabilities().controllable);

		const sent = await view.control?.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "go on from the phone",
			attachments: [],
		});
		expect(sent).toEqual({ status: "accepted", disposition: "started" });
		expect(prompts).toEqual(["go on from the phone"]);
		await view.close();

		const after = fileLock.open(path);
		expect(after.tryLock()).toBe(true);
		after.release();
	});

	test("a lock the bridge takes is refused to a terminal, and a session never locked is free without a file", async () => {
		const dir = presenceDir();
		const locks = new PresenceLocks(dir, fileLock);
		const unlocked = crypto.randomUUID();
		expect(locks.heldElsewhere(unlocked)).toBe(false);
		expect(existsSync(join(dir, `${unlocked}.lock`))).toBe(false);
		const sessionId = crypto.randomUUID();
		const taken = locks.take(sessionId);
		if (taken.kind !== "taken") throw new Error(`the lock was ${taken.kind}`);
		const other = await terminal(join(dir, `${sessionId}.lock`));
		expect(other.first).toBe("refused");
		await other.quit();
		expect(locks.take(sessionId).kind).toBe("held");
		taken.lock.release();
		const next = await terminal(join(dir, `${sessionId}.lock`));
		expect(next.first).toBe("held");
		await next.quit();
	});
});

/** What the hosted side gives the view once it takes the session: a controllable session that takes prompts. */
function hostedSession(ref: SessionRef, prompts: string[]) {
	const accepted = { status: "accepted" as const };
	const session: OpenSession = {
		session: ref,
		snapshot: emptySnapshot,
		control: {
			prompt: async (input) => {
				prompts.push(input.text);
				return { status: "accepted", disposition: "started" };
			},
			abort: async () => accepted,
			answer: async () => accepted,
			setModel: async () => accepted,
			setThinking: async () => accepted,
			setMode: async () => accepted,
			compact: async () => accepted,
		},
		close: async () => undefined,
	};
	return { status: "accepted" as const, session, snapshot: emptySnapshot() };
}
