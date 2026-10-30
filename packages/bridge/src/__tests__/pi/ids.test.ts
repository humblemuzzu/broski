import { describe, expect, test } from "bun:test";
import {
	blockId,
	entryAttachmentId,
	entryItemId,
	isUsableEntryId,
	MAX_ENTRY_ID_CHARS,
	mintInteractionId,
	mintMessageId,
	mintQueueItemId,
	mintRunId,
	parseEntryPart,
	storedToolCallId,
	ToolCallIds,
} from "../../backends/pi/ids";
import {
	AttachmentId,
	BlockId,
	InteractionId,
	MessageId,
	QueueItemId,
	RunId,
	ToolCallId,
	TranscriptItemId,
} from "../../contract";

describe("minted ids", () => {
	test("are valid contract ids and never repeat", () => {
		const minted = [mintRunId(), mintMessageId(), mintInteractionId(), mintQueueItemId()];
		expect(RunId.safeParse(minted[0]).success).toBe(true);
		expect(MessageId.safeParse(minted[1]).success).toBe(true);
		expect(InteractionId.safeParse(minted[2]).success).toBe(true);
		expect(QueueItemId.safeParse(minted[3]).success).toBe(true);
		const many = new Set(Array.from({ length: 1_000 }, () => mintRunId()));
		expect(many.size).toBe(1_000);
	});

	test("a block id is its message id and content index", () => {
		const messageId = mintMessageId();
		expect(blockId(messageId, 2)).toBe(`${messageId}:2`);
		expect(BlockId.safeParse(blockId(messageId, 2)).success).toBe(true);
	});
});

describe("entry-derived ids", () => {
	test("round-trip, including an entry id that holds a colon", () => {
		for (const entryId of ["a1b2c3d4", "0198f2e4-7c1a-7bde-9a51-3f5e0a2b4c6d", "odd:id", "x:1"]) {
			expect(parseEntryPart(entryItemId(entryId, 0))).toEqual({ entryId, index: 0 });
			expect(parseEntryPart(entryAttachmentId(entryId, 17))).toEqual({ entryId, index: 17 });
		}
	});

	test("ids this adapter did not derive do not parse", () => {
		for (const id of ["", "a1b2c3d4", ":3", "a1b2:", "a1b2:01", "a1b2:-1", "a1b2:1.5", "a1b2: 3", "a1b2:9999999999"]) {
			expect(parseEntryPart(id)).toBeUndefined();
		}
		expect(parseEntryPart(`${"e".repeat(MAX_ENTRY_ID_CHARS + 1)}:0`)).toBeUndefined();
	});

	test("the longest usable entry id still fits every id bound it is used in", () => {
		const longest = "e".repeat(MAX_ENTRY_ID_CHARS);
		expect(isUsableEntryId(longest)).toBe(true);
		expect(isUsableEntryId("")).toBe(false);
		const index = 999_999_999;
		expect(MessageId.safeParse(entryItemId(longest, index)).success).toBe(true);
		expect(TranscriptItemId.safeParse(entryItemId(longest, index)).success).toBe(true);
		expect(AttachmentId.safeParse(entryAttachmentId(longest, index)).success).toBe(true);
	});
});

describe("tool call ids", () => {
	test("a stored id is where the call sits, whatever id the provider gave it", () => {
		const longest = "e".repeat(MAX_ENTRY_ID_CHARS);
		expect(storedToolCallId("a1b2c3d4", 2)).toBe("a1b2c3d4:2");
		expect(storedToolCallId("a1b2c3d4", 2)).not.toBe(storedToolCallId("a1b2c3d4", 3));
		expect(ToolCallId.safeParse(storedToolCallId(longest, 999_999_999)).success).toBe(true);
		expect(parseEntryPart(storedToolCallId("a1b2c3d4", 2))).toEqual({ entryId: "a1b2c3d4", index: 2 });
	});

	test("a response maps each Pi id to one live id, and a later response or run never reuses one", () => {
		const run = new ToolCallIds();
		const live = run.liveId("call_0");
		expect(run.liveId("call_0")).toBe(live);
		expect(run.find("call_0")).toBe(live);
		expect(run.find("call_1")).toBeUndefined();
		expect(run.liveId("call_0/1")).not.toBe(live);
		expect(ToolCallId.safeParse(live).success).toBe(true);
		run.nextResponse();
		expect(run.find("call_0")).toBeUndefined();
		expect(run.liveId("call_0")).not.toBe(live);
		expect(new ToolCallIds().liveId("call_0")).not.toBe(live);
	});

	test("a denial is remembered for the response it happened in", () => {
		const run = new ToolCallIds();
		run.deny("call_0");
		expect(run.wasDenied("call_0")).toBe(true);
		expect(run.wasDenied("call_1")).toBe(false);
		run.nextResponse();
		expect(run.wasDenied("call_0")).toBe(false);
	});
});
