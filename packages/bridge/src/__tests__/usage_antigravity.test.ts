import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravitySource, NO_READING } from "../usage/antigravity-usage";
import type { UsageSystem } from "../usage/system";
import { usageReader } from "../usage/usage-reader";

const NOW = Date.parse("2026-11-27T18:00:00Z");
const CAPTURED = NOW - 20 * 60_000;
const dirs: string[] = [];

/** A machine whose files are real and which can reach nothing: the reader must need neither the network nor a command. */
function machine(): { system: UsageSystem; broskiDir: string; write: (text: string) => void } {
	const broskiDir = mkdtempSync(join(tmpdir(), "broski-agy-usage-"));
	dirs.push(broskiDir);
	const system: UsageSystem = {
		platform: "darwin",
		piAgentDir: "/pi",
		claudeDir: "/claude",
		now: () => NOW,
		fetch: () => Promise.reject(new Error("Antigravity's usage must not reach the network")),
		readText: (path) => readFile(path, "utf8").catch(() => undefined),
		run: () => Promise.reject(new Error("Antigravity's usage must not run a command")),
	};
	const write = (text: string) => {
		mkdirSync(join(broskiDir, "antigravity"), { recursive: true });
		writeFileSync(join(broskiDir, "antigravity", "quota.json"), text);
	};
	return { system, broskiDir, write };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** agy's status-line `quota` as the docs give it (antigravity.google/docs/cli/statusline), with the buckets agy 1.5.18 sends. */
const QUOTA = {
	"gemini-5h": { remaining_fraction: 0.5, reset_in_seconds: 3_600 },
	"gemini-weekly": { remaining_fraction: 0.9378, reset_time: "2026-12-04T05:43:00Z", reset_in_seconds: 560_580 },
	"3p-5h": { remaining_fraction: 1, reset_in_seconds: 18_000 },
	"3p-weekly": { remaining_fraction: 0.25, reset_in_seconds: 400_000, disabled: true },
	"gemini-credits": { remaining_amount: 120 },
};

describe("Antigravity's plan usage, from agy's own status line", () => {
	test("is each bucket agy gave its status line, as of when agy gave it, under the plan agy names over ACP", async () => {
		const { system, broskiDir, write } = machine();
		write(JSON.stringify({ captured_at_ms: CAPTURED, quota: QUOTA }));
		const result = await usageReader([antigravitySource(system, broskiDir, () => "Google AI Ultra")], () => NOW).read();
		if (result.status !== "accepted") throw new Error("usage was not read");
		expect(result.meters).toEqual([
			{
				plan: "antigravity",
				displayName: "Antigravity",
				tier: "Google AI Ultra",
				readAt: CAPTURED,
				windows: [
					{
						id: "gemini-5h",
						span: "five_hour",
						scope: "Gemini",
						usedPercent: 50,
						resetsAt: CAPTURED + 3_600_000,
						history: [{ at: CAPTURED, usedPercent: 50 }],
					},
					{
						id: "gemini-weekly",
						span: "week",
						scope: "Gemini",
						usedPercent: expect.closeTo(6.22, 5),
						resetsAt: Date.parse("2026-12-04T05:43:00Z"),
						history: [{ at: CAPTURED, usedPercent: expect.closeTo(6.22, 5) }],
					},
					{
						id: "3p-5h",
						span: "five_hour",
						scope: "Claude",
						usedPercent: 0,
						resetsAt: CAPTURED + 18_000_000,
						history: [{ at: CAPTURED, usedPercent: 0 }],
					},
				],
			},
		]);
	});

	test("with no reading yet says how to get one once agy is signed in, and shows nothing before", async () => {
		const { system, broskiDir } = machine();
		expect(await antigravitySource(system, broskiDir, () => undefined).read()).toBeUndefined();
		expect(await antigravitySource(system, broskiDir, () => "Google AI Pro").read()).toEqual({
			problem: NO_READING,
			tier: "Google AI Pro",
		});
	});

	test("a file Broski cannot read is a problem, never a crash or a made-up window", async () => {
		const { system, broskiDir, write } = machine();
		for (const text of ["{not json", JSON.stringify({ quota: QUOTA }), JSON.stringify({ captured_at_ms: CAPTURED })]) {
			write(text);
			const reading = await antigravitySource(system, broskiDir, () => undefined).read();
			expect(reading).toMatchObject({ problem: expect.stringContaining("cannot read") });
		}
		write(JSON.stringify({ captured_at_ms: CAPTURED, quota: { "gemini-5h": { remaining_fraction: 7 }, odd: 1 } }));
		expect(await antigravitySource(system, broskiDir, () => undefined).read()).toEqual({
			windows: [],
			readAt: CAPTURED,
		});
	});
});
