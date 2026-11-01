import { describe, expect, test } from "bun:test";
import {
	emptySnapshot,
	type Interaction,
	type JsonValue,
	ServerMessage,
	type SessionSnapshot,
	type TranscriptItem,
} from "../contract";
import { encodeFrame } from "../core/frame";
import { elide } from "../core/text-elision";
import { fitMessage } from "../core/wire-fit";
import { RecordingLog } from "./helpers/core-rig";

const MIB = 1024 * 1024;

function attachAnswer(snapshot: SessionSnapshot): ServerMessage {
	return {
		type: "session.attach.result",
		requestId: "q",
		capabilities: { controllable: true, compact: true, cancelQueued: true },
		sync: { kind: "snapshot", epoch: "e", lastSeq: 3, snapshot },
	};
}

function fittedSnapshot(snapshot: SessionSnapshot, cap: number): { bytes: number; snapshot: SessionSnapshot } {
	const frame = fitMessage(attachAnswer(snapshot), cap, new RecordingLog());
	if (!frame) throw new Error("did not fit");
	const message = ServerMessage.parse(JSON.parse(frame.text).message);
	if (message.type !== "session.attach.result" || message.sync.kind !== "snapshot") throw new Error("not a snapshot");
	return { bytes: frame.bytes, snapshot: message.sync.snapshot };
}

function openBlocks(count: number, text: string): SessionSnapshot["blocks"] {
	return Array.from({ length: count }, (_, index) => ({
		blockId: `o${index}`,
		messageId: `m${index}`,
		kind: "text",
		text,
	}));
}

describe("cutting text to fit the link", () => {
	test("keeps every run item and as much text as fits when the open blocks are what is too large", () => {
		const items: TranscriptItem[] = Array.from({ length: 500 }, (_, index) => ({
			kind: "block",
			id: `b${index}`,
			messageId: `m${index}`,
			block: "text",
			text: "x".repeat(1_000),
		}));
		const snapshot: SessionSnapshot = {
			...emptySnapshot(),
			blocks: openBlocks(10, "y".repeat(MIB)),
			run: { runId: "r", trigger: "prompt", startedAt: 1, items, droppedItems: 0 },
		};
		const fitted = fittedSnapshot(snapshot, 8 * MIB);
		expect(fitted.bytes).toBeLessThanOrEqual(8 * MIB);
		expect(fitted.bytes).toBeGreaterThan(8 * MIB - 32);
		expect(fitted.snapshot.run?.items).toEqual(items);
		expect(fitted.snapshot.run?.droppedItems).toBe(0);
		const lengths = new Set(fitted.snapshot.blocks.map((block) => block.text.length));
		expect(lengths.size).toBe(1);
	});

	test("text whose JSON is longer than it looks, escapes and astral characters, still fits exactly", () => {
		for (const unit of ["\u0000", "😀", '"', "é", "日"]) {
			const snapshot = { ...emptySnapshot(), blocks: openBlocks(12, unit.repeat(Math.floor(400_000 / unit.length))) };
			const fitted = fittedSnapshot(snapshot, 2 * MIB);
			expect(fitted.bytes).toBeLessThanOrEqual(2 * MIB);
			expect(fitted.bytes).toBeGreaterThan(2 * MIB - 12 * 8);
		}
	});

	test("text whose cheap part is cut finds its length in a few measurements, not one per unit", () => {
		const cap = 64 * 1024;
		const text = `${"a".repeat(30_000)}${"é".repeat(30_000)}`;
		const tree: JsonValue = { blocks: [{ text }, { text }] };
		let measured = 0;
		const fits = elide(tree, { roots: [["blocks"]], keepsTail: () => true }, (candidate) => {
			measured += 1;
			return Buffer.byteLength(JSON.stringify(candidate)) - cap;
		});
		expect(fits).toBe(true);
		expect(Buffer.byteLength(JSON.stringify(tree))).toBeLessThanOrEqual(cap);
		expect(Buffer.byteLength(JSON.stringify(tree))).toBeGreaterThan(cap - 8);
		expect(measured).toBeLessThanOrEqual(12);
	});

	test("text is never cut below its floor: when the floor does not fit, nothing does", () => {
		const snapshot = { ...emptySnapshot(), blocks: openBlocks(100, "w".repeat(5_000)) };
		expect(fitMessage(attachAnswer(snapshot), 64 * 1024, new RecordingLog())).toBeUndefined();
		const fitted = fittedSnapshot({ ...snapshot, blocks: openBlocks(50, "w".repeat(5_000)) }, 64 * 1024);
		expect(fitted.snapshot.blocks.every((block) => block.text.length >= 1_024)).toBe(true);
	});

	test("the cut length is the longest that fits: one unit more would not", () => {
		const snapshot = { ...emptySnapshot(), blocks: openBlocks(3, "z".repeat(50_000)) };
		const cap = 64 * 1024;
		const fitted = fittedSnapshot(snapshot, cap);
		const kept = fitted.snapshot.blocks[0]?.text.length ?? 0;
		const longer = { ...emptySnapshot(), blocks: openBlocks(3, `…${"z".repeat(kept)}`) };
		expect(encodeFrame(attachAnswer(longer)).bytes).toBeGreaterThan(cap);
	});

	test("a file cut to fit is sent truncated and cannot be edited; one that fits whole is sent as it is", () => {
		const answer = (text: string, editable: boolean, problems: string[] = []): ServerMessage => ({
			type: "backend.call.result",
			requestId: "q",
			result: {
				status: "accepted",
				result: {
					kind: "config_file",
					file: {
						id: "settings",
						path: "/p/.claude/settings.json",
						scope: "project",
						format: "json",
						exists: true,
						text,
						revision: "r1",
						editable,
						truncated: false,
						problems,
					},
				},
			},
		});
		const fileOf = (message: ServerMessage, cap: number) => {
			const frame = fitMessage(message, cap, new RecordingLog());
			const sent = frame && ServerMessage.parse(JSON.parse(frame.text).message);
			if (sent?.type !== "backend.call.result" || sent.result.status !== "accepted") throw new Error("no answer");
			if (sent.result.result.kind !== "config_file") throw new Error("no file");
			return sent.result.result.file;
		};
		const whole = fileOf(answer("x".repeat(30_000), true), 64 * 1024);
		expect(whole).toMatchObject({ editable: true, truncated: false });
		const cut = fileOf(answer("x".repeat(100_000), true), 64 * 1024);
		expect(cut).toMatchObject({ editable: false, truncated: true });
		expect(cut.text.endsWith("…")).toBe(true);
		const readOnly = fileOf(answer("x".repeat(30_000), false), 64 * 1024);
		expect(readOnly).toMatchObject({ editable: false, truncated: false });
		const readOnlyCut = fileOf(answer("x".repeat(100_000), false), 64 * 1024);
		expect(readOnlyCut).toMatchObject({ editable: false, truncated: true });
		const longProblem = ["p".repeat(200_000)];
		const wholeText = fileOf(answer("x".repeat(10_000), false, longProblem), 64 * 1024);
		expect(wholeText).toMatchObject({ editable: false, truncated: false });
		const wholeEditable = fileOf(answer("x".repeat(10_000), true, longProblem), 64 * 1024);
		expect(wholeEditable).toMatchObject({ editable: true, truncated: false });
	});

	test("an edit is locked only when the length found cuts it, whatever lengths were tried on the way", () => {
		const request = (text: string): Interaction => ({
			id: `p${text.length}`,
			createdAt: 1,
			title: "Plan",
			blocksRun: true,
			request: { kind: "plan_approval", plan: text, editable: true },
		});
		// The block's head is two bytes a unit and its kept tail one, so the first estimate cuts too much, the plan included.
		const plan = request("p".repeat(30_000));
		const blocks = openBlocks(1, `${"é".repeat(30_000)}${"a".repeat(30_000)}`);
		const fitted = fittedSnapshot({ ...emptySnapshot(), interactions: [plan], blocks }, 64 * 1024);
		expect(fitted.snapshot.interactions[0]).toEqual(plan);
		const both = {
			...emptySnapshot(),
			interactions: [request("p".repeat(40_000))],
			blocks: openBlocks(1, "q".repeat(40_000)),
		};
		const cut = fittedSnapshot(both, 64 * 1024);
		expect(cut.snapshot.interactions[0]?.request).toMatchObject({ kind: "plan_approval", editable: false });
	});
});
