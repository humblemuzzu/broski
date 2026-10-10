import { afterEach, describe, expect, test } from "bun:test";
import { OC_TAIL_MESSAGE_LIMIT, startOpenCodeExternalTail } from "../oc-external-tail";

type OcMessage = { info: { id: string; role: string }; parts: unknown[]; text: string };

let allMessages: OcMessage[] = [];
const tails: Array<{ stop: () => void }> = [];

afterEach(() => {
	for (const tail of tails.splice(0)) tail.stop();
	allMessages = [];
});

function message(index: number): OcMessage {
	return {
		info: { id: `m${index}`, role: index % 2 === 0 ? "user" : "assistant" },
		parts: [{ id: `p${index}`, type: "text", text: `text ${index}` }],
		text: `text ${index}`,
	};
}

/** The SDK's newest-page query: `limit` returns the tail of the transcript, no limit returns it all. */
function makeFakeOc(limits: number[]) {
	return {
		getSessionStatus: async () => ({}),
		getSessionMessages: async (_sessionId: string, _directory?: string, limit?: number) => {
			if (limit !== undefined) limits.push(limit);
			if (limit === undefined) return allMessages;
			return allMessages.slice(Math.max(0, allMessages.length - limit));
		},
		listPendingPermissions: async () => [],
		listPendingQuestions: async () => [],
	};
}

function startTail(oc: ReturnType<typeof makeFakeOc>, events: unknown[]): void {
	tails.push(
		startOpenCodeExternalTail("session-1", "/tmp/project", {
			enqueueSdkEvent: (event) => {
				events.push(event);
			},
			oc,
			logDebug: () => {},
			DEBUG_RTS: false,
		}),
	);
}

type Payload = { payload: { type: string; properties?: { info?: { id?: string } } } };

function updatedMessageIds(events: unknown[]): string[] {
	return events
		.filter((event) => (event as Payload).payload.type === "message.updated")
		.map((event) => (event as Payload).payload.properties?.info?.id ?? "");
}

/** The tail polls on an interval; wait for the emitted page instead of assuming a delay. */
async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition() && Date.now() < deadline) await Bun.sleep(25);
}

describe("opencode external tail page gaps", () => {
	test("emits every message when more than a page arrives between two polls", async () => {
		allMessages = Array.from({ length: 10 }, (_, index) => message(index));
		const limits: number[] = [];
		const events: unknown[] = [];
		startTail(makeFakeOc(limits), events);

		await Bun.sleep(250);
		events.length = 0;
		allMessages = [...allMessages, ...Array.from({ length: 120 }, (_, index) => message(10 + index))];
		await waitFor(() => updatedMessageIds(events).length >= 120);

		expect(updatedMessageIds(events)).toEqual(Array.from({ length: 120 }, (_, index) => `m${10 + index}`));
	});

	test("keeps asking for one page while the newest page still holds the previous tail", async () => {
		allMessages = Array.from({ length: 200 }, (_, index) => message(index));
		const limits: number[] = [];
		const events: unknown[] = [];
		startTail(makeFakeOc(limits), events);

		await Bun.sleep(250);
		events.length = 0;
		allMessages = [...allMessages, message(200)];
		await waitFor(() => updatedMessageIds(events).length >= 1);

		expect(updatedMessageIds(events)).toEqual(["m200"]);
		expect(new Set(limits)).toEqual(new Set([OC_TAIL_MESSAGE_LIMIT]));
		expect(limits.length).toBeGreaterThan(0);
	});
});
