/**
 * The plan readers against stand-ins for the machine: the sign-in stores, the agy binary and the services, with
 * answers in the shapes the real services gave (Claude Code 2.1.325's usage endpoint, agy 1.5.11's quota summary).
 */

import { describe, expect, test } from "bun:test";
import type { PlanUsageResult } from "../contract";
import { AGY_SIGNED_OUT, decodeKeyring } from "../usage/antigravity-login";
import { antigravitySource, antigravityWindows } from "../usage/antigravity-usage";
import { CLAUDE_EXPIRED, claudeSource, claudeWindows } from "../usage/claude-usage";
import type { PlanReading, PlanSource } from "../usage/plan-source";
import type { UsageSystem } from "../usage/system";
import { type HistoryStore, SPAN_MS, UsageHistory } from "../usage/usage-history";
import { FRESH_FOR_MS, usageReader } from "../usage/usage-reader";

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
	readonly binaries?: Record<string, string>;
	readonly commands?: Record<string, string>;
	readonly answer: (url: string, body: string) => [number, unknown];
}

function machine(stand: Stand): { system: UsageSystem; asked: Asked[] } {
	const asked: Asked[] = [];
	const system: UsageSystem = {
		platform: "darwin",
		arch: "arm64",
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
			if (argv[0] === "security") {
				const service = argv[argv.indexOf("-s") + 1];
				const account = argv.includes("-a") ? argv[argv.indexOf("-a") + 1] : undefined;
				return stand.keychain?.[account ? `${service}/${account}` : `${service}`];
			}
			return stand.commands?.[argv.join(" ")];
		},
		which: (name) => stand.binaries?.[name] ?? null,
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

const AGY_QUOTA = {
	groups: [
		{
			displayName: "Gemini Models",
			buckets: [
				{ bucketId: "gemini-weekly", window: "weekly", resetTime: "2026-11-25T09:13:01Z", remainingFraction: 0.75 },
				{ bucketId: "gemini-5h", window: "5h", resetTime: "2026-11-18T19:13:01Z" },
			],
		},
		{
			displayName: "Claude and GPT models",
			buckets: [{ bucketId: "3p-5h", window: "5h", resetTime: "2026-11-18T23:05:16Z", remainingFraction: 1 }],
		},
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

describe("Antigravity's windows", () => {
	test("one per bucket, the group as the scope, and a bucket without a remaining fraction used up", () => {
		expect(antigravityWindows(AGY_QUOTA)).toEqual([
			{
				id: "gemini-weekly",
				span: "week",
				scope: "Gemini",
				usedPercent: 25,
				resetsAt: Date.parse("2026-11-25T09:13:01Z"),
			},
			{
				id: "gemini-5h",
				span: "five_hour",
				scope: "Gemini",
				usedPercent: 100,
				resetsAt: Date.parse("2026-11-18T19:13:01Z"),
			},
			{
				id: "3p-5h",
				span: "five_hour",
				scope: "Claude and GPT",
				usedPercent: 0,
				resetsAt: Date.parse("2026-11-18T23:05:16Z"),
			},
		]);
	});
});

function agyKeyring(expiry: string): string {
	const json = JSON.stringify({ token: { access_token: "old", refresh_token: "refresh-1", expiry } });
	return `go-keyring-base64:${Buffer.from(json).toString("base64")}`;
}

const AGY_BINARY = "/bin/agy";
const SCAN = `grep -a -Eo GOCSPX-[A-Za-z0-9_-]{28}|[0-9]{6,}-[a-z0-9]{20,}\\.apps\\.googleusercontent\\.com ${AGY_BINARY}`;
const SECRET = `GOCSPX-${"s".repeat(28)}`;
const WRONG_ID = `111111-${"a".repeat(20)}.apps.googleusercontent.com`;
const RIGHT_ID = `222222-${"b".repeat(20)}.apps.googleusercontent.com`;

function agyMachine(tokenAnswer: (body: string) => [number, unknown]) {
	return machine({
		keychain: { "gemini/antigravity": agyKeyring("2026-11-18T16:00:00+05:30") },
		binaries: { agy: AGY_BINARY },
		commands: { [SCAN]: `${WRONG_ID}\n${SECRET}\n${RIGHT_ID}\n`, [`${AGY_BINARY} --version`]: "1.5.11\n" },
		answer: (url, body) => {
			if (url.endsWith("/token")) return tokenAnswer(body);
			if (url.endsWith(":loadCodeAssist"))
				return [200, { cloudaicompanionProject: "proj-1", paidTier: { name: "Google AI Ultra" } }];
			return [200, AGY_QUOTA];
		},
	});
}

describe("Antigravity's sign-in", () => {
	test("a lapsed token is renewed with agy's own client, then the quota is read as agy reads it", async () => {
		const { system, asked } = agyMachine((body) =>
			body.includes("111111") ? [401, { error: "invalid_client" }] : [200, { access_token: "fresh", expires_in: 3600 }],
		);
		const source = antigravitySource(system);
		const reading = await source.read();
		expect(reading).toEqual({ windows: antigravityWindows(AGY_QUOTA), tier: "Google AI Ultra" });
		const quota = asked.find((ask) => ask.url.endsWith(":retrieveUserQuotaSummary"));
		expect(quota?.headers.authorization).toBe("Bearer fresh");
		expect(quota?.headers["user-agent"]).toBe(
			"antigravity/cli/1.5.11 (aidev_client; os_type=darwin; arch=arm64; auth_method=consumer)",
		);
		expect(JSON.parse(quota?.body ?? "{}")).toEqual({ project: "proj-1" });
		const renewals = () => asked.filter((ask) => ask.url.endsWith("/token")).length;
		expect(renewals()).toBe(2);
		await source.read();
		expect(renewals()).toBe(2);
	});

	test("a refresh token Google refuses asks for a new sign-in", async () => {
		const { system } = agyMachine(() => [400, { error: "invalid_grant" }]);
		expect(await antigravitySource(system).read()).toEqual({ problem: AGY_SIGNED_OUT });
	});

	test("go-keyring's hex and plain payloads read like its base64 one", () => {
		const json = JSON.stringify({ token: { access_token: "a", refresh_token: "r", expiry: 1_795_000_000 } });
		const expected = { access: "a", refresh: "r", expiresAt: 1_795_000_000_000 };
		expect(decodeKeyring(`go-keyring-encoded:${Buffer.from(json).toString("hex")}`)).toEqual(expected);
		expect(decodeKeyring(`go-keyring-raw:${json}`)).toEqual(expected);
		expect(decodeKeyring("go-keyring-raw:{}")).toBeUndefined();
	});
});

describe("a window's history", () => {
	const STEP = SPAN_MS.five_hour / 120;
	const resetsAt = NOW + 2 * HOUR;
	const window = (usedPercent: number, reset = resetsAt) =>
		({ id: "gemini-5h", span: "five_hour", usedPercent, resetsAt: reset }) as const;

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
		history.record("antigravity", [window(10)], NOW);
		history.record("antigravity", [window(12)], NOW + STEP / 2);
		const [read] = history.record("antigravity", [window(15)], NOW + STEP * 2);
		expect(read?.history).toEqual([
			{ at: NOW + STEP / 2, usedPercent: 12 },
			{ at: NOW + STEP * 2, usedPercent: 15 },
		]);
		const next = resetsAt + SPAN_MS.five_hour;
		const [restarted] = history.record("antigravity", [window(1, next)], resetsAt + STEP);
		expect(restarted?.history).toEqual([{ at: resetsAt + STEP, usedPercent: 1 }]);
		expect(store.saved).toEqual({ "antigravity:gemini-5h": [{ at: resetsAt + STEP, usedPercent: 1 }] });
	});

	test("what the store kept is where a restarted bridge goes on from", () => {
		const stored = { "antigravity:gemini-5h": [{ at: NOW - HOUR, usedPercent: 4 }] };
		const history = new UsageHistory({ load: () => stored, save: () => {} });
		const [read] = history.record("antigravity", [window(9)], NOW);
		expect(read?.history).toEqual([...stored["antigravity:gemini-5h"], { at: NOW, usedPercent: 9 }]);
	});
});

describe("the usage reader", () => {
	function scripted(plan: "claude" | "antigravity", readings: Array<PlanReading | undefined>) {
		let reads = 0;
		const source: PlanSource = { plan, read: async () => readings[Math.min(reads++, readings.length - 1)] };
		return { source, reads: () => reads };
	}

	test("one reading answers for a minute, and a failed read keeps the last windows with why", async () => {
		let now = NOW;
		const window = { id: "weekly_all", span: "week", usedPercent: 10 } as const;
		const claude = scripted("claude", [{ windows: [window], tier: "Pro" }, { problem: "Claude answered 429." }]);
		const antigravity = scripted("antigravity", [undefined]);
		const reader = usageReader([claude.source, antigravity.source], () => now);
		const first = await reader.read();
		expect(first).toEqual({
			status: "accepted",
			meters: [{ plan: "claude", tier: "Pro", windows: [window], readAt: NOW }],
		});
		now += FRESH_FOR_MS - 1;
		expect(await reader.read()).toBe(first);
		expect(claude.reads()).toBe(1);
		now += 1;
		const second: PlanUsageResult = await reader.read();
		expect(second).toEqual({
			status: "accepted",
			meters: [{ plan: "claude", tier: "Pro", windows: [window], readAt: NOW, problem: "Claude answered 429." }],
		});
	});
});
