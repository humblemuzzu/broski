/** `forks.jsonl` is compacted like the owner journal, so every link it keeps is one it can read back. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ForkLinks,
	MAX_FORK_ID_CHARS,
	MAX_LINKS,
	MAX_READ_BYTES,
} from "../../../backends/claude-code/store/fork-links";

let stateDir: string;

beforeEach(() => {
	stateDir = mkdtempSync(join(tmpdir(), "broski-forks-"));
});

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
});

const lines = () => readFileSync(join(stateDir, "forks.jsonl"), "utf8").split("\n").filter(Boolean);

describe("fork links", () => {
	test("past twice the bound the file is rewritten from memory, and a new reader sees the newest links", async () => {
		const forks = new ForkLinks(stateDir, 10);
		for (let n = 0; n < 35; n += 1) await forks.link(`fork-${n}`, `parent-${n}`);
		expect(lines().length).toBeLessThanOrEqual(20);
		const again = new ForkLinks(stateDir, 10);
		expect(await again.parentOf("fork-34")).toBe("parent-34");
		expect(await again.parentOf("fork-25")).toBe("parent-25");
		expect(await again.parentOf("fork-0")).toBeUndefined();
	});

	test("a full file of the longest ids fits the read-back bound, so no kept link is dropped unread", () => {
		const id = "x".repeat(MAX_FORK_ID_CHARS);
		const lineBytes = JSON.stringify({ f: id, p: id }).length + 1;
		expect((2 * MAX_LINKS + 1) * lineBytes).toBeLessThan(MAX_READ_BYTES);
	});

	test("an id longer than a session id is not kept", async () => {
		const forks = new ForkLinks(stateDir, 10);
		await forks.link("y".repeat(MAX_FORK_ID_CHARS + 1), "parent");
		expect(await forks.parentOf("y".repeat(MAX_FORK_ID_CHARS + 1))).toBeUndefined();
	});
});
