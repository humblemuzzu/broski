/**
 * The kit's unified diff against the system's own tools: `patch` turns the old text into the new one with it, and its
 * counts are the smallest edit `git diff --minimal` finds.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unifiedDiff } from "../adapter-kit/unified-diff";

const dir = mkdtempSync(join(tmpdir(), "broski-unified-diff-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A deterministic edit of `lines`: lines dropped, changed and added at random places. */
function edited(lines: readonly string[], seed: number): string[] {
	let state = seed;
	const next = () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
	const out: string[] = [];
	for (const line of lines) {
		const roll = next();
		if (roll < 0.1) continue;
		out.push(roll < 0.2 ? `${line} changed` : line);
		if (next() < 0.08) out.push(`added after ${line}`);
	}
	return out;
}

function applied(oldText: string, diff: string): string {
	const target = join(dir, "target.txt");
	writeFileSync(target, oldText);
	writeFileSync(join(dir, "change.diff"), `${diff}\n`);
	const run = spawnSync("patch", ["-s", target, join(dir, "change.diff")], { encoding: "utf8" });
	expect(run.status).toBe(0);
	return readFileSync(target, "utf8");
}

function gitCounts(oldText: string, newText: string): [number, number] {
	writeFileSync(join(dir, "a.txt"), oldText);
	writeFileSync(join(dir, "b.txt"), newText);
	const run = spawnSync("git", ["diff", "--no-index", "--minimal", "--numstat", "a.txt", "b.txt"], {
		cwd: dir,
		encoding: "utf8",
	});
	const [added, deleted] = run.stdout.trim().split(/\s+/).map(Number);
	return [added ?? 0, deleted ?? 0];
}

describe("a unified diff of two texts", () => {
	const base = Array.from({ length: 120 }, (_, at) => `line ${at % 17 === 0 ? "repeated" : at}`);

	test.each([1, 2, 3, 4, 5, 6, 7, 8])("patches the old text into the new one, minimally (seed %i)", (seed) => {
		const oldText = `${base.join("\n")}\n`;
		const newText = `${edited(base, seed).join("\n")}\n`;
		const { diff, additions, deletions } = unifiedDiff("/Users/me/project/notes.txt", oldText, newText);
		expect(applied(oldText, diff)).toBe(newText);
		expect([additions, deletions]).toEqual(gitCounts(oldText, newText));
	});

	test("past the edit bound removes and adds the changed middle whole, which still patches", () => {
		const oldText = `head\n${Array.from({ length: 600 }, (_, at) => `old ${at}`).join("\n")}\ntail\n`;
		const newText = `head\n${Array.from({ length: 600 }, (_, at) => `new ${at}`).join("\n")}\ntail\n`;
		const { diff, additions, deletions } = unifiedDiff("/Users/me/project/rewritten.txt", oldText, newText);
		expect(applied(oldText, diff)).toBe(newText);
		expect([additions, deletions]).toEqual([600, 600]);
	});

	test("of a new file adds every line, and of the same text is empty", () => {
		const created = unifiedDiff("/Users/me/project/new.ts", undefined, "one\ntwo\n");
		expect(created).toEqual({
			diff: "--- /dev/null\n+++ /Users/me/project/new.ts\n@@ -0,0 +1,2 @@\n+one\n+two",
			additions: 2,
			deletions: 0,
		});
		expect(unifiedDiff("/Users/me/project/same.ts", "a\nb\n", "a\nb\n")).toEqual({
			diff: "",
			additions: 0,
			deletions: 0,
		});
	});
});
