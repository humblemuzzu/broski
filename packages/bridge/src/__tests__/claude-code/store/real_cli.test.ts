/**
 * What the store reads from the transcripts the real CLI writes (a scripted endpoint, a temp home, zero escapes): the
 * prompts' send uuids (adapter README D10), the block and tool ids, a subagent's files, fork and rename on files the
 * CLI made.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { childRef } from "../../../backends/claude-code/ids";
import type { TranscriptItem } from "../../../contract";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { withConfigDir } from "../spike/rig/config-env";
import { expectNoOrphans } from "../spike/rig/orphans";
import { startSpike } from "../spike/rig/session";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";

expectNoOrphans();

const CLI_TEST_MS = 60_000;
const sessionId = randomUUID();
let world: StoreWorld;
let home: ClaudeHome;
let firstSend = "";
let secondSend = "";
let escapes: string[] = [];

async function pages(id: string, limit: number): Promise<TranscriptItem[]> {
	const items: TranscriptItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await world.store.transcript(id, { limit, ...(cursor !== undefined && { cursor }) }, world.live);
		if (page.status !== "accepted") throw new Error(page.rejection.message);
		items.push(...page.page.items);
		cursor = page.page.nextCursor;
	} while (cursor !== undefined);
	return items;
}

beforeAll(async () => {
	home = createClaudeHome();
	const spike = startSpike({
		home,
		permissionMode: "default",
		options: { sessionId },
		turns: [
			{
				thinking: ["Considering."],
				text: ["Let me read it."],
				toolCalls: [{ name: "Read", args: { file_path: "README.md" } }],
			},
			{ text: ["The magic word is PLUMBUS."] },
			{
				toolCalls: [
					{
						name: "Agent",
						args: {
							description: "Find the word",
							prompt: "Read README.md",
							subagent_type: "general-purpose",
							run_in_background: false,
						},
					},
				],
			},
			{ text: ["Main: done."] },
			{ text: ["spare"] },
		],
		server: {
			sideRequests: {
				subagent: [
					{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
					{ text: ["Subagent: PLUMBUS."] },
				],
			},
		},
	});
	try {
		firstSend = spike.send("what is the magic word?");
		await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(firstSend) === true);
		secondSend = spike.send("use a subagent");
		await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(secondSend) === true);
		await Bun.sleep(300);
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

describe("transcripts the real CLI wrote", () => {
	test("the run stayed on the scripted endpoint", () => {
		expect(escapes).toEqual([]);
	});

	test(
		"the session is listed with the real cwd, the SDK's title (the last prompt, not the first), and the prompts' uuids are the sends'",
		async () => {
			const found = await world.store.get(sessionId, world.live);
			if (found.status !== "accepted") throw new Error(found.rejection.message);
			expect(found.summary).toMatchObject({
				cwd: realpathSync(world.home.projectDir),
				title: { text: "use a subagent", source: "generated" },
				origin: "external",
				status: "unknown",
			});
			const items = await pages(sessionId, 200);
			const prompts = items.filter((item) => item.kind === "user_message");
			expect(prompts.map((item) => item.id)).toEqual([secondSend, firstSend]);
			await world.ownership.notePrompt(sessionId, firstSend, { imageNames: [] });
			const again = (await pages(sessionId, 200)).filter((item) => item.kind === "user_message");
			expect(again.map((item) => item.kind === "user_message" && item.clientRequestId)).toEqual([undefined, firstSend]);
		},
		CLI_TEST_MS,
	);

	test(
		"a tool turn reads as thinking, text, the call and its result, with the live ids",
		async () => {
			const items = await pages(sessionId, 200);
			const kinds = items.map((item) => (item.kind === "block" ? `block:${item.block}` : item.kind));
			const first = kinds.lastIndexOf("user_message");
			expect(kinds.slice(first, first + 1)).toEqual(["user_message"]);
			const call = items.find((item) => item.kind === "tool_call" && item.name === "Read");
			expect(call).toBeDefined();
			const result = items.find(
				(item) => item.kind === "tool_result" && call?.kind === "tool_call" && item.toolCallId === call.toolCallId,
			);
			expect(result?.id).toBe(`${call?.id}:result`);
			const blocks = items.filter(
				(item) => item.kind === "block" && item.messageId === (call?.kind === "tool_call" ? call.messageId : ""),
			);
			expect(blocks.map((item) => item.kind === "block" && item.block).sort()).toEqual(["text", "thinking"]);
			expect(new Set(blocks.map((item) => item.id)).size).toBe(blocks.length);
			for (const block of blocks) expect(block.id).toMatch(/^msg_.+:[01]$/);
			expect(items.some((item) => item.kind === "block" && item.text === "The magic word is PLUMBUS.")).toBe(true);
		},
		CLI_TEST_MS,
	);

	test(
		"pages of one item equal one big page, newest first",
		async () => {
			const whole = await pages(sessionId, 200);
			expect((await pages(sessionId, 1)).map((item) => item.id)).toEqual(whole.map((item) => item.id));
			expect(new Set(whole.map((item) => item.id)).size).toBe(whole.length);
			expect(whole[0]).toMatchObject({ kind: "block", text: "Main: done." });
		},
		CLI_TEST_MS,
	);

	test(
		"the subagent is a child session: listed, readable, and named by the Agent call",
		async () => {
			const children = await world.store.list(
				{ parent: { backend: "claude-code", sessionId } },
				{ limit: 10 },
				world.live,
			);
			if (children.status !== "accepted") throw new Error(children.rejection.message);
			expect(children.page.items).toHaveLength(1);
			const [child] = children.page.items;
			const ref = child?.session.sessionId ?? "";
			expect(ref.startsWith(`${sessionId}/`)).toBe(true);
			expect(child).toMatchObject({
				parent: { kind: "subagent" },
				title: { text: "Find the word" },
				source: "general-purpose",
			});
			const items = await pages(ref, 50);
			expect(items.some((item) => item.kind === "block" && item.text === "Subagent: PLUMBUS.")).toBe(true);
			expect(items.some((item) => item.kind === "tool_call" && item.name === "Read")).toBe(true);
			const parent = await pages(sessionId, 200);
			const agent = parent.find((item) => item.kind === "tool_call" && item.name === "Agent");
			expect(agent?.kind === "tool_call" && agent.childSession?.sessionId).toBe(ref);
			expect(childRef(sessionId, ref.slice(sessionId.length + 1))).toBe(ref);
		},
		CLI_TEST_MS,
	);

	test(
		"lastChainUuid is the CLI's newest entry",
		async () => {
			const chain = await withConfigDir(home, () => getSessionMessages(sessionId, { dir: home.projectDir }));
			expect(await world.store.lastChainUuid(sessionId)).toBe(chain.at(-1)?.uuid ?? null);
		},
		CLI_TEST_MS,
	);

	test(
		"rename, fork through the first answer, and delete work on files the CLI made",
		async () => {
			expect((await world.store.rename(sessionId, "Renamed by the phone", world.live)).status).toBe("accepted");
			const renamed = await world.store.get(sessionId, world.live);
			expect(renamed.status === "accepted" && renamed.summary.title).toEqual({
				text: "Renamed by the phone",
				source: "user",
			});
			const items = await pages(sessionId, 200);
			const answer = items.find((item) => item.kind === "block" && item.text === "The magic word is PLUMBUS.");
			const forked = await world.store.fork(sessionId, { itemId: answer?.id ?? "", position: "through" }, world.live);
			if (forked.status !== "accepted") throw new Error(forked.rejection.message);
			const copy = await pages(forked.session.sessionId, 200);
			expect(copy[0]).toMatchObject({ kind: "block", text: "The magic word is PLUMBUS." });
			expect(copy).toHaveLength(items.length - items.findIndex((item) => item.id === answer?.id));
			const stored = await world.store.locate(forked.session.sessionId);
			if ("status" in stored) throw new Error("fork not found");
			expect((await world.store.remove(forked.session.sessionId)).status).toBe("accepted");
			expect(existsSync(stored.path)).toBe(false);
			const rows = await world.store.list({ cwd: realpathSync(world.home.projectDir) }, { limit: 10 }, world.live);
			expect(rows.status === "accepted" && rows.page.items.map((row) => row.session.sessionId)).toEqual([sessionId]);
		},
		CLI_TEST_MS,
	);
});
