/**
 * A session a terminal `agy` has open, as the bridge watches agy's presence lock while another real process takes and
 * lets go of a real `flock` on it (`platform/file-lock.ts`, standing in for the terminal): the view is watch-only while
 * the lock is held, promotes itself once it is free, goes back to watching when it is taken again, and is hosted on the
 * phone's first action. The bridge's own looks at the lock hold it no longer than the look: once the holders have gone,
 * the lock is anyone's. A lock the bridge made for a session agy has none of leaves no file behind.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockFile } from "../../adapter-kit/ports";
import { PresenceLocks } from "../../backends/antigravity/live/lock";
import { openWatched, WATCHING_NOTICE } from "../../backends/antigravity/live/watch";
import { emptySnapshot, type OpenSession, type SessionRef, type SinkRecord, sessionCapabilities } from "../../contract";
import { fileLock } from "../../platform/file-lock";
import { lockHolder } from "./lock-holder";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function presenceDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-agy-presence-"));
	dirs.push(dir);
	return dir;
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
		const first = await lockHolder(path);
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

		const again = await lockHolder(path);
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

	test("the phone's first prompt is sent while the bridge's own lock is taken and the session still loading", async () => {
		const dir = presenceDir();
		const ref: SessionRef = { backend: "antigravity", sessionId: crypto.randomUUID() };
		const locks = new PresenceLocks(dir, fileLock);
		const first = await lockHolder(join(dir, `${ref.sessionId}.lock`));
		const records: SinkRecord[] = [];
		const prompts: string[] = [];
		const taken: LockFile[] = [];
		const opened = await openWatched(
			{
				ref,
				terminalHolds: () => locks.heldElsewhere(ref.sessionId),
				locate: async () => ({}),
				openHosted: async () => {
					const lock = locks.take(ref.sessionId);
					if (lock.kind !== "taken") throw new Error(`the lock was ${lock.kind}`);
					taken.push(lock.lock);
					await Bun.sleep(300);
					return hostedSession(ref, prompts);
				},
				pollMs: 20,
				now: () => 1_000,
			},
			{},
			{ emit: (record) => records.push(record) },
		);
		if (opened.status !== "accepted") throw new Error(opened.rejection.message);
		const view = opened.session;
		await first.quit();
		await until(() => sessionCapabilities(view).controllable);

		const sent = await view.control?.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "first from the phone",
			attachments: [],
		});
		expect(sent).toEqual({ status: "accepted", disposition: "started" });
		expect(prompts).toEqual(["first from the phone"]);
		expect(locks.heldElsewhere(ref.sessionId)).toBe(false);
		expect(records.map((record) => record.event.type)).toEqual(["notice", "resynced", "session_replaced", "resynced"]);
		await view.close();
		for (const lock of taken) lock.release();
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
		const other = await lockHolder(join(dir, `${sessionId}.lock`));
		expect(other.first).toBe("refused");
		await other.quit();
		expect(locks.heldElsewhere(sessionId)).toBe(false);
		expect(locks.take(sessionId).kind).toBe("held");
		taken.lock.release();
		const next = await lockHolder(join(dir, `${sessionId}.lock`));
		expect(next.first).toBe("held");
		expect(locks.heldElsewhere(sessionId)).toBe(true);
		await next.quit();
	});

	test("a lock taken for a session agy turns out not to have goes with its file, unless a terminal made the file", async () => {
		const dir = presenceDir();
		const locks = new PresenceLocks(dir, fileLock);
		const unknown = crypto.randomUUID();
		const taken = locks.take(unknown);
		if (taken.kind !== "taken") throw new Error(`the lock was ${taken.kind}`);
		expect(existsSync(join(dir, `${unknown}.lock`))).toBe(true);
		taken.discard();
		expect(existsSync(join(dir, `${unknown}.lock`))).toBe(false);
		expect(locks.heldElsewhere(unknown)).toBe(false);

		const known = crypto.randomUUID();
		const path = join(dir, `${known}.lock`);
		const earlier = await lockHolder(path);
		await earlier.quit();
		const again = locks.take(known);
		if (again.kind !== "taken") throw new Error(`the lock was ${again.kind}`);
		again.discard();
		expect(existsSync(path)).toBe(true);
		const next = await lockHolder(path);
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
