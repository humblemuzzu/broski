/** A real `/compact` (scripted summary): how the CLI's compaction reads back through the store (adapter README D26). */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { entryTimestamp, isCompactSummary } from "../../../backends/claude-code/store/message-parts";
import type { TranscriptItem } from "../../../contract";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { indexOf } from "../spike/rig/order";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, startSpike } from "../spike/rig/session";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";

expectNoOrphans();

const CLI_TEST_MS = 60_000;
const sessionId = randomUUID();
let home: ClaudeHome;
let world: StoreWorld;
let escapes: string[] = [];

beforeAll(async () => {
	home = createClaudeHome();
	const spike = startSpike({
		home,
		permissionMode: "default",
		options: { sessionId },
		turns: [{ text: ["first answer"] }, { text: ["answer after the compaction"] }],
		server: { sideRequests: { compact: [{ text: ["<analysis>a</analysis>\n<summary>Scripted summary.</summary>"] }] } },
	});
	try {
		spike.send("hello");
		await spike.waitFor((m) => m.type === "result");
		await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
		const at = spike.messages.length;
		spike.send("/compact");
		await spike.waitFor((m) => m.type === "result", { after: at, timeoutMs: 20_000 });
		await spike.waitFor(isIdle, { after: at });
		const later = spike.messages.length;
		spike.send("and now?");
		await spike.waitFor((m) => m.type === "result", { after: later });
		await spike.waitFor(isIdle, { after: later });
	} finally {
		await spike.close();
	}
	escapes = spike.server.escapes();
	world = await createStoreWorld(home);
}, CLI_TEST_MS);

afterAll(async () => {
	await world?.dispose();
	home?.cleanup();
});

test(
	"the compaction is one item holding the CLI's summary, the command's own entries read as the command and its output, and pages agree",
	async () => {
		expect(escapes).toEqual([]);
		const read = async (limit: number): Promise<TranscriptItem[]> => {
			const items: TranscriptItem[] = [];
			let cursor: string | undefined;
			do {
				const page = await world.store.transcript(
					sessionId,
					{ limit, ...(cursor !== undefined && { cursor }) },
					world.live,
				);
				if (page.status !== "accepted") throw new Error(page.rejection.message);
				items.push(...page.page.items);
				cursor = page.page.nextCursor;
			} while (cursor !== undefined);
			return items;
		};
		const whole = await read(200);
		expect(whole.map((item) => item.kind)).toEqual(["block", "user_message", "activity", "user_message", "compaction"]);
		expect(whole[2]).toMatchObject({ kind: "activity", activity: { kind: "command", body: { text: "Compacted" } } });
		expect(whole[3]).toMatchObject({ kind: "user_message", text: "/compact" });
		const compaction = whole.find((item) => item.kind === "compaction");
		expect(compaction?.kind === "compaction" && compaction.summary).toContain("Scripted summary.");
		expect(compaction).toMatchObject({
			trigger: "manual",
			tokensBefore: expect.any(Number),
			tokensAfter: expect.any(Number),
		});
		expect(whole[0]).toMatchObject({ kind: "block", text: "answer after the compaction" });
		expect((await read(1)).map((item) => item.id)).toEqual(whole.map((item) => item.id));
		expect(new Set(whole.map((item) => item.id)).size).toBe(whole.length);
	},
	CLI_TEST_MS,
);

test("getSessionMessages still returns the timestamp and isCompactSummary the SDK's type does not declare", async () => {
	const messages = await world.sdk.getSessionMessages(sessionId);
	expect(messages.length).toBeGreaterThan(0);
	for (const message of messages) expect(entryTimestamp(message)).toBeNumber();
	expect(messages.filter(isCompactSummary)).toHaveLength(1);
});
