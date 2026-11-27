/**
 * The plan readers against stand-ins for the machine: the sign-in stores and the services, with answers in the shapes
 * the real services gave (Claude Code 2.1.325's usage endpoint).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanUsageResult } from "../contract";
import { CLAUDE_EXPIRED, claudeSource, claudeWindows } from "../usage/claude-usage";
import type { PlanReading, PlanSource } from "../usage/plan-source";
import type { UsageSystem } from "../usage/system";
import { type HistoryStore, SPAN_MS, UsageHistory } from "../usage/usage-history";
import { FRESH_FOR_MS, machineUsage, usageReader } from "../usage/usage-reader";

const NOW = Date.parse("2026-11-18T18:00:00Z");
const HOUR = 3_600_000;

interface Asked {
	readonly url: string;
	readonly headers: Record<string, string>;
	readonly body: string;
}

interface Stand {
	readonly files?: Record<string, string>;
	readonly keychain?: Record<string, string>;
	readonly answer: (url: string, body: string) => [number, unknown];
}

function machine(stand: Stand): { system: UsageSystem; asked: Asked[] } {
	const asked: Asked[] = [];
	const system: UsageSystem = {
		platform: "darwin",
		piAgentDir: "/pi",
		claudeDir: "/claude",
		now: () => NOW,
		async fetch(url, init) {
			const body = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? "");
			asked.push({ url, headers: init.headers as Record<string, string>, body });
			const [status, value] = stand.answer(url, body);
			return new Response(JSON.stringify(value), { status });
		},
		readText: async (path) => stand.files?.[path],
		async run(argv) {
			if (argv[0] !== "security") return undefined;
			const service = argv[argv.indexOf("-s") + 1];
			const account = argv.includes("-a") ? argv[argv.indexOf("-a") + 1] : undefined;
			return stand.keychain?.[account ? `${service}/${account}` : `${service}`];
		},
	};
	return { system, asked };
}

const CLAUDE_USAGE = {
	five_hour: null,
	seven_day: { utilization: 55.0, resets_at: "2026-11-21T20:59:59.826819+00:00" },
	seven_day_opus: null,
	extra_usage: { is_enabled: false },
	limits: [
		{
			kind: "weekly_all",
			group: "weekly",
			percent: 55,
			severity: "normal",
			resets_at: "2026-11-21T20:59:59.826819+00:00",
			scope: null,
			is_active: true,
		},
		{
			kind: "weekly_scoped",
			group: "weekly",
			percent: 0,
			severity: "normal",
			resets_at: "2026-11-21T21:00:00+00:00",
			scope: { model: { id: null, display_name: "Fable" }, surface: null },
			is_active: false,
		},
		{ kind: "something_new", group: "weekly", percent: 9, resets_at: null },
	],
};

function claudeCodeCredentials(expiresAt: number): string {
	return JSON.stringify({
		claudeAiOauth: {
			accessToken: "cc-token",
			expiresAt,
			scopes: ["user:inference", "user:profile"],
			subscriptionType: "max",
			rateLimitTier: "default_claude_max_5x",
		},
	});
}

function piAuth(entries: Record<string, unknown>): Record<string, string> {
	return { "/pi/auth.json": JSON.stringify(entries) };
}

describe("Claude's windows", () => {
	test("come from the limits rows by kind, the older fields only where a row leaves a window out", () => {
		expect(claudeWindows(CLAUDE_USAGE)).toEqual([
			{ id: "weekly_all", span: "week", usedPercent: 55, resetsAt: Date.parse("2026-11-21T20:59:59.826819Z") },
			{
				id: "weekly_scoped:Fable",
				span: "week",
				scope: "Fable",
				usedPercent: 0,
				resetsAt: Date.parse("2026-11-21T21:00:00Z"),
			},
		]);
		const older = {
			five_hour: { utilization: 12.5, resets_at: "2026-11-18T20:00:00Z" },
			seven_day: { utilization: 40, resets_at: null },
		};
		expect(claudeWindows(older)).toEqual([
			{ id: "five_hour", span: "five_hour", usedPercent: 12.5, resetsAt: Date.parse("2026-11-18T20:00:00Z") },
			{ id: "seven_day", span: "week", usedPercent: 40 },
		]);
	});
});

describe("Claude's sign-in", () => {
	test("the one with time left is used, and the tier comes from Claude Code's even when its token lapsed", async () => {
		const { system, asked } = machine({
			keychain: { "Claude Code-credentials": claudeCodeCredentials(NOW - HOUR) },
			files: piAuth({ anthropic: { type: "oauth", access: "pi-token", refresh: "r", expires: NOW + HOUR } }),
			answer: () => [200, CLAUDE_USAGE],
		});
		const reading = await claudeSource(system).read();
		expect(reading && "windows" in reading && reading.windows.length).toBe(2);
		expect(reading?.tier).toBe("Max 5x");
		expect(asked.map((ask) => ask.headers.authorization)).toEqual(["Bearer pi-token"]);
		expect(asked[0]?.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
	});

	test("lapsed everywhere is a problem without asking the service; none at all leaves the plan out", async () => {
		const lapsed = machine({
			files: { "/claude/.credentials.json": claudeCodeCredentials(NOW - HOUR) },
			answer: () => [200, CLAUDE_USAGE],
		});
		expect(await claudeSource(lapsed.system).read()).toEqual({ problem: CLAUDE_EXPIRED, tier: "Max 5x" });
		expect(lapsed.asked).toEqual([]);
		expect(await claudeSource(machine({ answer: () => [500, {}] }).system).read()).toBeUndefined();
	});
});

describe("a window's history", () => {
	const STEP = SPAN_MS.five_hour / 120;
	const resetsAt = NOW + 2 * HOUR;
	const window = (usedPercent: number, reset = resetsAt) =>
		({ id: "five_hour", span: "five_hour", usedPercent, resetsAt: reset }) as const;

	function memoryStore(): HistoryStore & { saved: Record<string, unknown> } {
		const store = {
			saved: {} as Record<string, unknown>,
			load: () => ({}),
			save: (series: Record<string, unknown>) => {
				store.saved = series;
			},
		};
		return store;
	}

	test("keeps a point per step, the latest within one, and starts over with the window", () => {
		const store = memoryStore();
		const history = new UsageHistory(store);
		history.record("claude", [window(10)], NOW);
		history.record("claude", [window(12)], NOW + STEP / 2);
		const [read] = history.record("claude", [window(15)], NOW + STEP * 2);
		expect(read?.history).toEqual([
			{ at: NOW + STEP / 2, usedPercent: 12 },
			{ at: NOW + STEP * 2, usedPercent: 15 },
		]);
		const next = resetsAt + SPAN_MS.five_hour;
		const [restarted] = history.record("claude", [window(1, next)], resetsAt + STEP);
		expect(restarted?.history).toEqual([{ at: resetsAt + STEP, usedPercent: 1 }]);
		expect(store.saved).toEqual({ "claude:five_hour": [{ at: resetsAt + STEP, usedPercent: 1 }] });
	});

	test("what the store kept is where a restarted bridge goes on from", () => {
		const stored = { "claude:five_hour": [{ at: NOW - HOUR, usedPercent: 4 }] };
		const history = new UsageHistory({ load: () => stored, save: () => {} });
		const [read] = history.record("claude", [window(9)], NOW);
		expect(read?.history).toEqual([...stored["claude:five_hour"], { at: NOW, usedPercent: 9 }]);
	});
});

describe("the usage reader", () => {
	function scripted(plan: string, displayName: string, readings: Array<PlanReading | undefined>) {
		let reads = 0;
		const source: PlanSource = {
			plan,
			displayName,
			read: async () => readings[Math.min(reads++, readings.length - 1)],
		};
		return { source, reads: () => reads };
	}

	test("one reading answers for a minute, and a failed read keeps the last windows with why", async () => {
		let now = NOW;
		const window = { id: "weekly_all", span: "week", usedPercent: 10 } as const;
		const claude = scripted("claude", "Claude", [
			{ windows: [window], tier: "Pro" },
			{ problem: "Claude answered 429." },
		]);
		const signedOut = scripted("codex", "Codex", [undefined]);
		const reader = usageReader([claude.source, signedOut.source], () => now);
		const first = await reader.read();
		expect(first).toEqual({
			status: "accepted",
			meters: [{ plan: "claude", displayName: "Claude", tier: "Pro", windows: [window], readAt: NOW }],
		});
		now += FRESH_FOR_MS - 1;
		expect(await reader.read()).toBe(first);
		expect(claude.reads()).toBe(1);
		now += 1;
		const second: PlanUsageResult = await reader.read();
		expect(second).toEqual({
			status: "accepted",
			meters: [
				{
					plan: "claude",
					displayName: "Claude",
					tier: "Pro",
					windows: [window],
					readAt: NOW,
					problem: "Claude answered 429.",
				},
			],
		});
	});

	test("a source given beside the built-in ones is sampled, kept for a minute and answered with them", async () => {
		const broskiDir = mkdtempSync(join(tmpdir(), "broski-usage-"));
		try {
			const { system } = machine({
				files: piAuth({ anthropic: { type: "oauth", access: "pi-token", refresh: "r", expires: NOW + HOUR } }),
				answer: () => [200, CLAUDE_USAGE],
			});
			const window = { id: "weekly", span: "week", usedPercent: 30 } as const;
			const codex = scripted("codex", "Codex", [{ windows: [window], tier: "Plus" }]);
			const shadow = scripted("claude", "Not Claude", [{ windows: [] }]);
			const logged: string[] = [];
			const usage = machineUsage(system, broskiDir, (line) => void logged.push(line), [codex.source, shadow.source]);
			const stop = usage.sample();
			const result = await usage.read();
			stop();
			if (result.status !== "accepted") throw new Error("usage was not read");
			expect(result.meters.map((meter) => [meter.plan, meter.displayName])).toEqual([
				["claude", "Claude"],
				["codex", "Codex"],
			]);
			expect(result.meters[1]).toMatchObject({ tier: "Plus", readAt: NOW, windows: [window] });
			expect(codex.reads()).toBe(1);
			expect(shadow.reads()).toBe(0);
			expect(logged).toEqual(["[usage] a second claude plan source is left out"]);
		} finally {
			rmSync(broskiDir, { recursive: true, force: true });
		}
	});
});
