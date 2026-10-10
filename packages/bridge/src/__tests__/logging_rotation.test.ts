import { describe, expect, test } from "bun:test";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBridgeLogger } from "../logging/logger";
import { isFdRedirectedToFile } from "../logging/redirect-detect";
import { RotatingFileWriter } from "../logging/rotating-file";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "broski-log-"));
}

function linesContaining(path: string, needle: string): number {
	if (!existsSync(path)) return 0;
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter((line) => line.includes(needle)).length;
}

function totalBytes(paths: string[]): number {
	return paths.filter((path) => existsSync(path)).reduce((sum, path) => sum + statSync(path).size, 0);
}

describe("RotatingFileWriter", () => {
	test("rotates before the live file exceeds maxBytes", async () => {
		const dir = tempDir();
		const path = join(dir, "bridge.log");
		const writer = new RotatingFileWriter({ path, maxBytes: 200, keep: 3 });
		const chunk = `${"x".repeat(49)}\n`;

		for (let i = 0; i < 20; i++) writer.write(chunk);
		await writer.close();

		expect(statSync(path).size).toBeLessThanOrEqual(200);
		expect(existsSync(`${path}.1`)).toBe(true);
		expect(existsSync(`${path}.2`)).toBe(true);
		expect(existsSync(`${path}.3`)).toBe(true);
		expect(existsSync(`${path}.4`)).toBe(false);
	});

	test("bounds total disk use to keep + 1 files", async () => {
		const dir = tempDir();
		const path = join(dir, "bridge.log");
		const writer = new RotatingFileWriter({ path, maxBytes: 1_000, keep: 3 });

		for (let i = 0; i < 500; i++) writer.write(`${"y".repeat(99)}\n`);
		await writer.close();

		const all = [path, `${path}.1`, `${path}.2`, `${path}.3`];
		expect(totalBytes(all)).toBeLessThanOrEqual(4 * 1_000);
		expect(totalBytes(all)).toBeGreaterThan(1_000);
	});

	test("keeps every line across rotations", async () => {
		const dir = tempDir();
		const path = join(dir, "bridge.log");
		const writer = new RotatingFileWriter({ path, maxBytes: 120, keep: 3 });

		for (let i = 0; i < 10; i++) writer.write(`line-${i}\n`);
		await writer.close();

		let seen = 0;
		for (const candidate of [path, `${path}.1`, `${path}.2`, `${path}.3`]) {
			if (!existsSync(candidate)) continue;
			const content = readFileSync(candidate, "utf-8");
			for (let i = 0; i < 10; i++) {
				if (content.includes(`line-${i}\n`)) seen++;
			}
		}
		expect(seen).toBe(10);
	});
});

describe("isFdRedirectedToFile", () => {
	test("matches a descriptor pointing at the same file", () => {
		const dir = tempDir();
		const path = join(dir, "bridge.log");
		const other = join(dir, "other.log");
		writeFileSync(path, "");
		writeFileSync(other, "");

		const fd = openSync(path, "a");
		try {
			expect(isFdRedirectedToFile(fd, path)).toBe(true);
			expect(isFdRedirectedToFile(fd, other)).toBe(false);
		} finally {
			closeSync(fd);
		}

		expect(isFdRedirectedToFile(fd, path)).toBe(false);
	});

	test("is false for a missing path or an unusable descriptor", () => {
		const dir = tempDir();
		const missing = join(dir, "missing.log");
		writeFileSync(join(dir, "present.log"), "");
		const fd = openSync(join(dir, "present.log"), "a");
		try {
			expect(isFdRedirectedToFile(fd, missing)).toBe(false);
		} finally {
			closeSync(fd);
		}
		expect(isFdRedirectedToFile(9_999, join(dir, "present.log"))).toBe(false);
	});
});

describe("bridge logger file ownership", () => {
	test("writes each line once when the logger owns the files", async () => {
		const dir = tempDir();
		const logger = createBridgeLogger({ logDir: dir, consoleLevel: "user", redirectProbe: () => false });

		logger.info("only-once");
		logger.error("only-once-error");
		await logger.flush();

		expect(linesContaining(join(dir, "bridge.log"), "only-once")).toBe(2);
		expect(linesContaining(join(dir, "bridge.log"), "only-once-error")).toBe(1);
		expect(linesContaining(join(dir, "bridge.error.log"), "only-once-error")).toBe(1);
		expect(readFileSync(join(dir, "bridge.log"), "utf-8")).toContain("[INFO] only-once");
	});

	test("skips the file a supervisor already writes and still prints to console", async () => {
		const dir = tempDir();
		const printed: string[] = [];
		const originalLog = console.log;
		console.log = (...args: string[]) => {
			printed.push(args.join(" "));
		};

		try {
			const logger = createBridgeLogger({
				logDir: dir,
				consoleLevel: "user",
				redirectProbe: (fd) => fd === 1,
			});
			logger.user("supervised-line");
			await logger.flush();
		} finally {
			console.log = originalLog;
		}

		const primary = join(dir, "bridge.log");
		expect(existsSync(primary) ? readFileSync(primary, "utf-8") : "").toBe("");
		expect(printed).toContain("supervised-line");
	});

	test("rotates its own log files while keeping every line", async () => {
		const dir = tempDir();
		const logger = createBridgeLogger({
			logDir: dir,
			consoleLevel: "user",
			redirectProbe: () => false,
			rotation: { maxBytes: 150, keep: 2 },
		});

		for (let i = 0; i < 10; i++) logger.info(`rotating-${i}`);
		await logger.flush();

		const primary = join(dir, "bridge.log");
		expect(existsSync(`${primary}.1`)).toBe(true);
		expect(statSync(primary).size).toBeLessThanOrEqual(150);
		expect(totalBytes([primary, `${primary}.1`, `${primary}.2`])).toBeLessThanOrEqual(300 + 150);
	});
});
