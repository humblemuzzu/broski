/**
 * The files in transit on their own: an upload or an export nobody touches goes after a while, two first parts of one
 * upload never both start it, an export that writes nothing leaves nothing, and the scratch directory neither keeps a
 * failure nor outlives the backend.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportSession } from "../../backends/pi/ops/export-session";
import { ExportDesk } from "../../backends/pi/transfer/export-desk";
import { Scratch } from "../../backends/pi/transfer/scratch";
import { UploadDesk } from "../../backends/pi/transfer/upload-desk";
import { createPiTestEnv, createTestModelRuntime } from "./helpers/pi-test-env";

const made: string[] = [];
const areas: Scratch[] = [];

afterEach(async () => {
	for (const area of areas.splice(0)) await area.dispose();
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function parentDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "broski-pi-scratch-")));
	made.push(dir);
	return dir;
}

function scratchIn(parent: string): Scratch {
	const area = new Scratch(() => parent);
	areas.push(area);
	return area;
}

/** Every directory in the scratch root of `parent`. */
function held(parent: string): string[] {
	return readdirSync(parent).flatMap((root) => readdirSync(join(parent, root)));
}

class Clock {
	at = 1_000_000;
	readonly now = () => this.at;
}

async function gone(path: string): Promise<boolean> {
	for (let tries = 0; tries < 200 && existsSync(path); tries++) await Bun.sleep(5);
	return !existsSync(path);
}

function codeOf(result: number | { readonly rejection: { readonly code: string } }): number | string {
	return typeof result === "number" ? result : result.rejection.code;
}

describe("an upload", () => {
	test("that lies idle is dropped with its file, and cannot be continued", async () => {
		const parent = parentDir();
		const clock = new Clock();
		const desk = new UploadDesk(scratchIn(parent), { now: clock.now, idleMs: 1_000 });
		expect(await desk.take("u", 0, Buffer.from("abc"))).toBe(3);
		clock.at += 999;
		expect(await desk.take("u", 3, Buffer.from("def"))).toBe(6);
		clock.at += 999;
		const path = await desk.pathOf("u");
		if (path === undefined) throw new Error("the upload is not held");
		clock.at += 1_000;
		expect(codeOf(await desk.take("u", 6, Buffer.from("ghi")))).toBe("invalid_input");
		expect(await gone(dirname(path))).toBe(true);
		desk.dispose();
	});

	test("that lies idle is dropped by the timer even when no other transfer comes", async () => {
		const parent = parentDir();
		const desk = new UploadDesk(scratchIn(parent), { idleMs: 20 });
		expect(await desk.take("abandoned", 0, Buffer.from("abc"))).toBe(3);
		const path = await desk.pathOf("abandoned");
		if (path === undefined) throw new Error("the upload is not held");
		expect(await gone(dirname(path))).toBe(true);
		desk.dispose();
	});

	test("whose first part arrives twice at once is started once: the second is told to wait", async () => {
		const parent = parentDir();
		const desk = new UploadDesk(scratchIn(parent));
		const [first, second] = await Promise.all([
			desk.take("u", 0, Buffer.from("first")),
			desk.take("u", 0, Buffer.from("second")),
		]);
		expect([codeOf(first), codeOf(second)]).toEqual([5, "busy"]);
		const path = await desk.pathOf("u");
		if (path === undefined) throw new Error("the upload is not held");
		expect(await Bun.file(path).text()).toBe("first");
		expect(held(parent)).toHaveLength(1);
		desk.dispose();
	});
});

describe("an export", () => {
	test("that lies idle is gone, and reading it says so", async () => {
		const clock = new Clock();
		const desk = new ExportDesk(scratchIn(parentDir()), { now: clock.now, idleMs: 1_000 });
		const slot = await desk.slot();
		const path = join(slot.dir, "session.jsonl");
		await Bun.write(path, "{}\n");
		await desk.keep(slot, { sessionId: "s", path, name: "s.jsonl", mimeType: "application/x-ndjson" });
		clock.at += 999;
		expect(desk.find(slot.exportId, "s")?.path).toBe(path);
		clock.at += 999;
		expect(desk.find(slot.exportId, "s")?.path).toBe(path);
		clock.at += 1_000;
		expect(desk.find(slot.exportId, "s")).toBeUndefined();
		expect(await gone(slot.dir)).toBe(true);
		desk.dispose();
	});

	test("of a session file that is no longer a file leaves no directory behind", async () => {
		const env = createPiTestEnv();
		try {
			const parent = parentDir();
			const desk = new ExportDesk(scratchIn(parent));
			const html = { agentDir: env.agentDir, modelRuntime: await createTestModelRuntime(env) };
			const locate = async () => ({ sessionId: "s", path: env.cwd, cwd: env.cwd, origin: "broski" as const });
			const result = await exportSession(
				{ store: { locate }, desk, html },
				{ kind: "export_session", sessionId: "s", format: "jsonl" },
			);
			expect(result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
			expect(held(parent)).toEqual([]);
			desk.dispose();
		} finally {
			env.dispose();
		}
	});
});

describe("the scratch directory", () => {
	test("that could not be made is tried again at the next use", async () => {
		const parent = parentDir();
		const missing = join(parent, "missing");
		const area = scratchIn(missing);
		await expect(area.makeDir()).rejects.toThrow();
		mkdirSync(missing);
		expect(existsSync(await area.makeDir())).toBe(true);
	});

	test("makes nothing once disposed, so nothing outlives the backend", async () => {
		const parent = parentDir();
		const area = scratchIn(parent);
		await area.makeDir();
		await area.dispose();
		expect(readdirSync(parent)).toEqual([]);
		await expect(area.makeDir()).rejects.toThrow("closed");
		expect(readdirSync(parent)).toEqual([]);
	});
});
