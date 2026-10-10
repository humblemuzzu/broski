import { afterEach, describe, expect, test } from "bun:test";
import { OC_TAIL_MESSAGE_LIMIT, startOpenCodeExternalTail } from "../oc-external-tail";

type OcMessage = { info: { id: string; role: string }; parts: unknown[]; text: string };

type FakeOc = {
	getSessionStatus: (directory?: string) => Promise<Record<string, { type: string }>>;
	getSessionMessages: (sessionId: string, directory?: string, limit?: number) => Promise<OcMessage[]>;
	listPendingPermissions: () => Promise<unknown[]>;
	listPendingQuestions: () => Promise<unknown[]>;
};

let allMessages: OcMessage[] = [];

function makeMessages(count: number, offset = 0): OcMessage[] {
	return Array.from({ length: count }, (_, index) => ({
		info: { id: `m${offset + index}`, role: (offset + index) % 2 === 0 ? "user" : "assistant" },
		parts: [{ id: `p${offset + index}`, type: "text", text: `text ${offset + index}` }],
		text: `text ${offset + index}`,
	}));
}

/** Honours the `limit` the tail passes, the way the SDK's newest-page query does. */
function makeFakeOc(honourLimit: boolean, limits: number[]): FakeOc {
	return {
		getSessionStatus: async () => ({}),
		getSessionMessages: async (_sessionId, _directory, limit) => {
			if (limit !== undefined) limits.push(limit);
			if (!honourLimit || limit === undefined) return allMessages;
			return allMessages.slice(Math.max(0, allMessages.length - limit));
		},
		listPendingPermissions: async () => [],
		listPendingQuestions: async () => [],
	};
}

type TailOutcome = { events: unknown[]; broadcasts: unknown[]; limits: number[] };

async function runTail(
	honourLimit: boolean,
	script: () => Promise<void>,
	settled: (seen: TailOutcome) => boolean,
): Promise<TailOutcome> {
	const events: unknown[] = [];
	const broadcasts: unknown[] = [];
	const limits: number[] = [];
	const oc = makeFakeOc(honourLimit, limits);
	const tail = startOpenCodeExternalTail("session-1", "/tmp/project", {
		enqueueSdkEvent: (event) => {
			events.push(event);
		},
		broadcastRaw: (message) => {
			broadcasts.push(message);
		},
		oc,
		logDebug: () => {},
		DEBUG_RTS: false,
	});

	const seen: TailOutcome = { events, broadcasts, limits };

	try {
		await Bun.sleep(250);
		events.length = 0;
		broadcasts.length = 0;
		await script();
		const deadline = Date.now() + 10_000;
		while (!settled(seen) && Date.now() < deadline) await Bun.sleep(25);
	} finally {
		tail.stop();
	}
	return seen;
}

function appendAssistant(text: string): void {
	const index = allMessages.length;
	allMessages = [
		...allMessages,
		{
			info: { id: `m${index}`, role: "assistant" },
			parts: [{ id: `p${index}`, type: "text", text }],
			text,
		},
	];
}

afterEach(() => {
	allMessages = [];
});

describe("opencode external tail", () => {
	test("asks for the newest page instead of the whole session", async () => {
		allMessages = makeMessages(400);
		const { limits } = await runTail(
			true,
			async () => {},
			(seen) => seen.limits.length > 0,
		);

		expect(limits.length).toBeGreaterThan(0);
		expect(new Set(limits)).toEqual(new Set([OC_TAIL_MESSAGE_LIMIT]));
	});

	test("emits the same events as fetching every message", async () => {
		allMessages = makeMessages(200);

		const script = async (): Promise<void> => {
			appendAssistant("a new answer");
			await Bun.sleep(50);
		};

		const limited = await runTail(true, script, (seen) => seen.events.length > 0);
		allMessages = makeMessages(200);
		const full = await runTail(false, script, (seen) => seen.events.length > 0);

		expect(limited.events.length).toBeGreaterThan(0);
		expect(JSON.stringify(limited.events)).toBe(JSON.stringify(full.events));
	});

	test("still reports a user message that arrives while busy", async () => {
		allMessages = makeMessages(200);

		const { broadcasts, events } = await runTail(
			true,
			async () => {
				const index = allMessages.length;
				allMessages = [
					...allMessages,
					{
						info: { id: `m${index}`, role: "user" },
						parts: [{ id: `p${index}`, type: "text", text: "typed on the mac" }],
						text: "typed on the mac",
					},
				];
				await Bun.sleep(50);
			},
			(seen) =>
				seen.events.length > 0 &&
				seen.broadcasts.some((message) => JSON.stringify(message).includes("typed on the mac")),
		);

		const updated = events.filter(
			(event) => (event as { payload?: { type?: string } }).payload?.type === "message.updated",
		);
		expect(updated).toHaveLength(1);
		expect(JSON.stringify(broadcasts)).toContain("typed on the mac");
	});
});
