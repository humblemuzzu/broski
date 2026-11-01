import { describe, expect, test } from "bun:test";
import {
	blockId,
	childRef,
	commandId,
	commandText,
	imageAttachmentId,
	isUuid,
	mintInteractionId,
	mintQueueItemId,
	mintRunId,
	parseBlockId,
	parseChildRef,
	parseImageAttachmentId,
	sendUuid,
	toolCallId,
	toolResultItemId,
	userItemId,
} from "../../../backends/claude-code/ids";
import { MAX_ID_CHARS, SessionId, TranscriptItemId } from "../../../contract";

const SESSION = "0b6c3c1e-2f0e-4a51-9a4e-7d3f1c2b9e10";
const AGENT = "a4434daa825db6e10";

describe("ids", () => {
	test("minted ids are fresh UUIDs", () => {
		const minted = [mintRunId(), mintInteractionId(), mintQueueItemId()];
		expect(minted.every(isUuid)).toBe(true);
		expect(new Set(minted).size).toBe(3);
	});

	test("D37: a prompt's send uuid is its clientRequestId, and the entry uuid is its item id", () => {
		const clientRequestId = crypto.randomUUID();
		expect(sendUuid(clientRequestId)).toBe(clientRequestId);
		expect(sendUuid("not-a-uuid")).toBeUndefined();
		expect(userItemId(clientRequestId)).toBe(clientRequestId);
	});

	test("block ids parse back at the last colon", () => {
		const id = blockId("msg_01:odd", 3);
		expect(id).toBe("msg_01:odd:3");
		expect(parseBlockId(id)).toEqual({ messageId: "msg_01:odd", index: 3 });
		expect(parseBlockId("msg_01")).toBeUndefined();
		expect(parseBlockId("msg_01:03")).toBeUndefined();
	});

	test("tool call ids are the API's, never cut", () => {
		expect(toolCallId("toolu_01")).toBe("toolu_01");
		expect(toolCallId("t".repeat(MAX_ID_CHARS + 1))).toBeUndefined();
		expect(toolResultItemId("toolu_01")).toBe("toolu_01:result");
	});

	test("image attachment ids name a user entry block, or an image inside a tool result", () => {
		const top = imageAttachmentId(SESSION, 1);
		const inner = imageAttachmentId(SESSION, 0, 2);
		expect(parseImageAttachmentId(top)).toEqual({ entryUuid: SESSION, blockIndex: 1 });
		expect(parseImageAttachmentId(inner)).toEqual({ entryUuid: SESSION, blockIndex: 0, innerIndex: 2 });
		expect(parseImageAttachmentId(`${SESSION}:x`)).toBeUndefined();
		expect(parseImageAttachmentId(crypto.randomUUID())).toBeUndefined();
	});

	test("a child ref joins the parent session and the agent id, within the contract's id bound", () => {
		const ref = childRef(SESSION, AGENT);
		expect(ref).toBe(`${SESSION}/${AGENT}`);
		expect(SessionId.safeParse(ref).success).toBe(true);
		expect(parseChildRef(ref ?? "")).toEqual({ parentId: SESSION, agentId: AGENT });
		expect(childRef("not-a-session", AGENT)).toBeUndefined();
		expect(childRef(SESSION, "bad/agent")).toBeUndefined();
		expect(parseChildRef(SESSION)).toBeUndefined();
		expect(parseChildRef(`${SESSION}/`)).toBeUndefined();
		expect(TranscriptItemId.safeParse(toolResultItemId(ref ?? "")).success).toBe(true);
	});

	test("commands are listed by name and sent as slash text", () => {
		expect(commandId("/review")).toBe("review");
		expect(commandId("two words")).toBeUndefined();
		expect(commandText("review", "")).toBe("/review");
		expect(commandText("review", "src/a.ts")).toBe("/review src/a.ts");
	});
});
