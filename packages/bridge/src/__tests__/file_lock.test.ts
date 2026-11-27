/** The `flock` port against another real process: what one holds, the other cannot take until the holder is gone. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLock } from "../platform/file-lock";

const MODULE = join(import.meta.dir, "..", "platform", "file-lock.ts");
const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function lockPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-file-lock-"));
	dirs.push(dir);
	return join(dir, "session.lock");
}

/** A `bun` that takes the lock, says so, and holds it until its stdin ends, exiting without releasing it. */
async function holder(path: string) {
	const script = `
		const { fileLock } = await import(${JSON.stringify(MODULE)});
		const held = fileLock.open(${JSON.stringify(path)}).tryLock();
		console.log(held ? "held" : "refused");
		for await (const _ of Bun.stdin.stream()) {}
		process.exit(0);
	`;
	const child = Bun.spawn([process.execPath, "-e", script], { stdin: "pipe", stdout: "pipe" });
	const reader = child.stdout.getReader();
	const first = new TextDecoder().decode((await reader.read()).value).trim();
	return { child, first };
}

describe("the file lock", () => {
	test("is refused while another process holds it, and taken once that process has exited", async () => {
		const path = lockPath();
		const { child, first } = await holder(path);
		expect(first).toBe("held");
		const mine = fileLock.open(path);
		expect(mine.tryLock()).toBe(false);
		child.stdin.end();
		await child.exited;
		expect(mine.tryLock()).toBe(true);
		mine.release();
	});

	test("makes the file 0600, and a released lock is the next holder's", async () => {
		const path = lockPath();
		const mine = fileLock.open(path);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(mine.tryLock()).toBe(true);
		const other = await holder(path);
		expect(other.first).toBe("refused");
		other.child.stdin.end();
		await other.child.exited;
		mine.release();
		expect(mine.tryLock()).toBe(false);
		const next = await holder(path);
		expect(next.first).toBe("held");
		next.child.stdin.end();
		await next.child.exited;
	});
});
