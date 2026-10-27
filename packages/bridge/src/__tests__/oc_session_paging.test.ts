/**
 * OpenCode transcript paging: `limit`/`before` in, `hasMore`/`nextCursor` out, over the same shared
 * contract the Claude Code, Codex and Pi handlers implement.
 */

import { describe, expect, test } from "bun:test";
import { OpenCodeConnector } from "../connectors/opencode";
import { handle } from "../handlers/oc_session_ops";
import type { ClientMessage, ServerMessage } from "../types";
import { DEFAULT_TRANSCRIPT_PAGE_LIMIT } from "../types/transcript-page";
import { makeClient } from "./fixtures/oc-connector-harness";

const TRANSCRIPT_LENGTH = 200;
const PAGE_LIMIT = 7;

type FixtureMessage = { info: { id: string }; parts: Array<{ type: "text"; text: string }> };

const transcript: FixtureMessage[] = Array.from({ length: TRANSCRIPT_LENGTH }, (_, index) => ({
	info: { id: `msg_${String(index).padStart(4, "0")}` },
	parts: [{ type: "text", text: `message ${index}` }],
}));
const transcriptIds = transcript.map((message) => message.info.id);

type SessionMessagesReply = {
	messages: FixtureMessage[];
	hasMore?: boolean;
	nextCursor?: string;
};

const sdkCalls: Array<Record<string, unknown>> = [];
const { client } = makeClient([], {
	session: {
		messages: async (args: Record<string, unknown>) => {
			sdkCalls.push(args);
			return { data: transcript };
		},
	},
});
const connector = new OpenCodeConnector({ client, baseUrl: "http://127.0.0.1:4096" });

function sessionMessages(reply: ServerMessage): SessionMessagesReply {
	if (reply.type !== "session_messages") throw new Error(`expected session_messages, got ${reply.type}`);
	return {
		messages: reply.data as FixtureMessage[],
		hasMore: reply.hasMore,
		nextCursor: reply.nextCursor,
	};
}

async function fetchPage(request: { limit?: number; before?: string }): Promise<SessionMessagesReply> {
	const replies: ServerMessage[] = [];
	const message = { type: "get_session_messages", sessionId: "ses_1", ...request } as ClientMessage & {
		requestId?: string;
	};
	const handled = await handle(
		message,
		(reply) => replies.push(reply),
		() => connector,
	);
	expect(handled).toBe(true);
	expect(replies).toHaveLength(1);
	return sessionMessages(replies[0]!);
}

describe("OpenCode get_session_messages paging", () => {
	test("every page from the tail concatenates to the whole transcript, with no duplicates", async () => {
		const pages: string[][] = [];
		let cursor: string | undefined;
		for (let page = 0; page <= Math.ceil(TRANSCRIPT_LENGTH / PAGE_LIMIT); page += 1) {
			const reply = await fetchPage(
				cursor === undefined ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, before: cursor },
			);
			pages.push(reply.messages.map((message) => message.info.id));
			if (!reply.hasMore) {
				expect(reply.nextCursor).toBeUndefined();
				break;
			}
			expect(reply.messages).toHaveLength(PAGE_LIMIT);
			expect(reply.nextCursor).toBe(reply.messages[0]!.info.id);
			cursor = reply.nextCursor;
		}

		const walked = [...pages].reverse().flat();
		expect(walked).toEqual(transcriptIds);
		expect(new Set(walked).size).toBe(TRANSCRIPT_LENGTH);
		expect(pages[0]).toEqual(transcriptIds.slice(TRANSCRIPT_LENGTH - PAGE_LIMIT));
	});

	test("a request without a limit answers the whole transcript as it always did", async () => {
		const reply = await fetchPage({});
		expect(reply.messages.map((message) => message.info.id)).toEqual(transcriptIds);
		expect(reply.hasMore).toBeUndefined();
		expect(reply.nextCursor).toBeUndefined();
	});

	test("a cursor without a limit uses the shared default page size", async () => {
		const reply = await fetchPage({ before: transcriptIds[120] });
		expect(reply.hasMore).toBe(true);
		expect(reply.messages).toHaveLength(DEFAULT_TRANSCRIPT_PAGE_LIMIT);
		expect(reply.messages.at(-1)?.info.id).toBe(transcriptIds[119]);
	});

	test("a cursor that names no message of the session falls back to the whole transcript", async () => {
		const reply = await fetchPage({ limit: PAGE_LIMIT, before: "msg_missing" });
		expect(reply.messages.map((message) => message.info.id)).toEqual(transcriptIds);
		expect(reply.hasMore).toBeUndefined();
	});

	test("paging is windowed here, so the OpenCode server is never asked for a page", async () => {
		sdkCalls.length = 0;
		await fetchPage({ limit: PAGE_LIMIT });
		expect(sdkCalls).toHaveLength(1);
		expect(sdkCalls[0]?.sessionID).toBe("ses_1");
		expect(sdkCalls[0]?.limit).toBeUndefined();
		expect(sdkCalls[0]?.before).toBeUndefined();
	});
});
