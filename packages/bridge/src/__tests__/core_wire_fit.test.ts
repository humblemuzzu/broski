import { describe, expect, test } from "bun:test";
import {
	type EventEnvelope,
	emptySnapshot,
	type Interaction,
	ServerMessage,
	type SessionSnapshot,
	type TranscriptItem,
} from "../contract";
import { encodeFrame } from "../core/frame";
import { shorten } from "../core/text-elision";
import { fitEvent, fitMessage } from "../core/wire-fit";
import { RecordingLog } from "./helpers/core-rig";

const CAP = 64 * 1024;
const SESSION = { backend: "pi" as const, sessionId: "s1" };

function textItem(index: number, chars: number): TranscriptItem {
	return { kind: "block", id: `b${index}`, messageId: `m${index}`, block: "text", text: "x".repeat(chars) };
}

function runningSnapshot(items: TranscriptItem[], extra: Partial<SessionSnapshot> = {}): SessionSnapshot {
	return {
		...emptySnapshot(),
		run: { runId: "r1", trigger: "prompt", startedAt: 1, items, droppedItems: 0 },
		...extra,
	};
}

function attachAnswer(snapshot: SessionSnapshot): ServerMessage {
	return {
		type: "session.attach.result",
		requestId: "q1",
		capabilities: { controllable: true, compact: true, cancelQueued: true, answer: true },
		sync: { kind: "snapshot", epoch: "e1", lastSeq: 9, snapshot },
	};
}

/** The message a frame carries, checked against the contract. */
function decoded(text: string): ServerMessage {
	return ServerMessage.parse(JSON.parse(text).message);
}

function snapshotOf(message: ServerMessage): SessionSnapshot {
	if (message.type !== "session.attach.result" || message.sync.kind !== "snapshot")
		throw new Error("not a snapshot sync");
	return message.sync.snapshot;
}

describe("fitting a message to the link", () => {
	test("a message that fits goes out as it is", () => {
		const message = attachAnswer(runningSnapshot([textItem(0, 10)]));
		expect(fitMessage(message, CAP, new RecordingLog())).toEqual(encodeFrame(message));
	});

	test("a long run's snapshot sheds its oldest items, counted in droppedItems, and keeps the newest whole", () => {
		const items = Array.from({ length: 1000 }, (_, index) => textItem(index, 1_000));
		const frame = fitMessage(attachAnswer(runningSnapshot(items)), CAP, new RecordingLog());
		if (!frame) throw new Error("did not fit");
		expect(frame.bytes).toBeLessThanOrEqual(CAP);
		const run = snapshotOf(decoded(frame.text)).run;
		if (!run) throw new Error("the run is gone");
		expect(run.droppedItems + run.items.length).toBe(1000);
		expect(run.items).toEqual(items.slice(run.droppedItems));
		const oneMore = attachAnswer(runningSnapshot(items.slice(run.droppedItems - 1)));
		expect(encodeFrame(oneMore).bytes).toBeGreaterThan(CAP);
	});

	test("when shedding items cannot make it fit, text is cut instead and every item stays: an open block keeps its end", () => {
		const blocks = [{ blockId: "open", messageId: "m", kind: "text" as const, text: `${"a".repeat(80_000)}THE END` }];
		const snapshot = runningSnapshot([textItem(0, 70_000), textItem(1, 10)], { blocks });
		const frame = fitMessage(attachAnswer(snapshot), CAP, new RecordingLog());
		if (!frame) throw new Error("did not fit");
		expect(frame.bytes).toBeLessThanOrEqual(CAP);
		expect(frame.bytes).toBeGreaterThan(CAP - 16);
		const fitted = snapshotOf(decoded(frame.text));
		expect(fitted.run?.droppedItems).toBe(0);
		const [cutItem, wholeItem] = fitted.run?.items ?? [];
		expect(wholeItem).toEqual(textItem(1, 10));
		const itemText = cutItem?.kind === "block" ? cutItem.text : "";
		expect(itemText.endsWith("…")).toBe(true);
		const text = fitted.blocks[0]?.text ?? "";
		expect(text.startsWith("…")).toBe(true);
		expect(text.endsWith("THE END")).toBe(true);
		expect(text.length).toBe(itemText.length);
	});

	test("when even text at its floor does not fit beside every item, the oldest items go as well", () => {
		const items = Array.from({ length: 30 }, (_, index) => textItem(index, 3_000));
		const blocks = [{ blockId: "open", messageId: "m", kind: "text" as const, text: "b".repeat(100_000) }];
		const frame = fitMessage(attachAnswer(runningSnapshot(items, { blocks })), CAP, new RecordingLog());
		if (!frame) throw new Error("did not fit");
		expect(frame.bytes).toBeLessThanOrEqual(CAP);
		const fitted = snapshotOf(decoded(frame.text));
		expect(fitted.run?.droppedItems).toBe(30);
		expect(fitted.blocks[0]?.text.length).toBeLessThan(100_000);
	});

	test("shortening never touches ids, names, paths, cursors or form conditions, and locks the edits it cut into", () => {
		const long = "y".repeat(50_000);
		const interaction: Interaction = {
			id: "i".repeat(256),
			createdAt: 1,
			title: "t".repeat(1_024),
			blocksRun: true,
			request: {
				kind: "tool_permission",
				input: { content: long },
				inputEditable: true,
				previews: [{ kind: "command", command: long }],
				options: [{ id: "allow", label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" }],
				grants: [],
				deliberate: false,
			},
		};
		const plan: Interaction = {
			id: "p1",
			createdAt: 1,
			title: "Plan",
			blocksRun: true,
			request: { kind: "plan_approval", plan: long, editable: true, path: `/${"d".repeat(4_000)}` },
		};
		const condition = [{ key: "k", op: "eq" as const, value: { kind: "text" as const, value: "z".repeat(5_000) } }];
		const form: Interaction = {
			id: "f1",
			createdAt: 1,
			title: "Form",
			blocksRun: true,
			request: {
				kind: "form",
				fields: [
					{ kind: "boolean", key: "k", required: false, hidden: false, when: [] },
					{
						kind: "string",
						key: "s",
						required: false,
						hidden: false,
						when: condition,
						options: [],
						allowCustom: false,
						description: long,
					},
				],
			},
		};
		const snapshot: SessionSnapshot = { ...emptySnapshot(), interactions: [interaction, plan, form] };
		const frame = fitMessage(attachAnswer(snapshot), CAP, new RecordingLog());
		if (!frame) throw new Error("did not fit");
		const [permission, approval, asked] = snapshotOf(decoded(frame.text)).interactions;
		expect(permission?.id).toBe(interaction.id);
		expect(permission?.title).toBe(interaction.title);
		expect(permission?.request).toMatchObject({ kind: "tool_permission", inputEditable: false });
		expect(approval?.request).toMatchObject({ kind: "plan_approval", editable: false, path: `/${"d".repeat(4_000)}` });
		expect(asked?.request).toMatchObject({ kind: "form", fields: [{ key: "k" }, { key: "s", when: condition }] });
		expect(JSON.stringify(asked).length).toBeLessThan(JSON.stringify(form).length);
	});

	test("a transcript page keeps its cursor whole while its items are shortened", () => {
		const nextCursor = "c".repeat(8_192);
		const message: ServerMessage = {
			type: "transcript.read.result",
			requestId: "q",
			result: { status: "accepted", page: { items: [textItem(0, 200_000)], nextCursor, idStability: "stable" } },
		};
		const frame = fitMessage(message, CAP, new RecordingLog());
		if (!frame) throw new Error("did not fit");
		const fitted = decoded(frame.text);
		expect(
			fitted.type === "transcript.read.result" && fitted.result.status === "accepted" && fitted.result.page.nextCursor,
		).toBe(nextCursor);
	});

	test("image bytes are never shortened: an image larger than the link does not fit at all", () => {
		const message: ServerMessage = {
			type: "attachment.read.result",
			requestId: "q",
			result: { status: "accepted", image: { kind: "image", mimeType: "image/png", data: "A".repeat(100_000) } },
		};
		expect(fitMessage(message, CAP, new RecordingLog())).toBeUndefined();
	});

	test("a form's condition value stays whole even when it is the longest text, and then nothing fits", () => {
		const condition = [{ key: "k", op: "eq" as const, value: { kind: "text" as const, value: "z".repeat(100_000) } }];
		const form: Interaction = {
			id: "f1",
			createdAt: 1,
			title: "Form",
			blocksRun: true,
			request: {
				kind: "form",
				fields: [
					{ kind: "boolean", key: "k", required: false, hidden: false, when: [] },
					{ kind: "boolean", key: "s", required: false, hidden: false, when: condition },
				],
			},
		};
		const message = attachAnswer({ ...emptySnapshot(), interactions: [form] });
		expect(fitMessage(message, CAP, new RecordingLog())).toBeUndefined();
	});

	test("a cut never splits a surrogate pair", () => {
		const text = "😀".repeat(10);
		expect(shorten(text, 6, false)).toBe("😀😀…");
		expect(shorten(text, 6, true)).toBe("…😀😀");
	});
});

describe("fitting an event", () => {
	const envelope = (event: EventEnvelope["event"]): EventEnvelope => ({ session: SESSION, seq: 4, at: 1, event });

	test("an event too large even shortened goes out as resynced, with the live state after it", () => {
		const content = Array.from({ length: 200 }, () => ({ kind: "text" as const, text: "z".repeat(5_000) }));
		const finished = envelope({
			type: "tool_finished",
			toolCallId: "t1",
			outcome: "completed",
			result: { content, fileChanges: [] },
		});
		const after = runningSnapshot([
			{
				kind: "tool_result",
				id: "t1:result",
				toolCallId: "t1",
				outcome: "completed",
				result: { content, fileChanges: [] },
			},
		]);
		const log = new RecordingLog();
		const frame = fitEvent(finished, after, CAP, log);
		expect(frame.bytes).toBeLessThanOrEqual(CAP);
		const message = decoded(frame.text);
		expect(message).toMatchObject({ type: "event", envelope: { seq: 4, event: { type: "resynced" } } });
		if (message.type === "event" && message.envelope.event.type === "resynced") {
			expect(message.envelope.event.snapshot.run).toMatchObject({ items: [], droppedItems: 1 });
		}
		expect(log.infos.some((line) => line.includes("sent as resynced"))).toBe(true);
	});

	test("when the live state cannot fit either, the event is replaced by an error saying what was left out", () => {
		const items = Array.from({ length: 300 }, (_, index) => ({
			id: `q${index}`,
			delivery: "queue" as const,
			preview: "p".repeat(5_000),
		}));
		const changed = envelope({ type: "queue_changed", items });
		const log = new RecordingLog();
		const frame = fitEvent(changed, { ...emptySnapshot(), queue: items }, CAP, log);
		const message = decoded(frame.text);
		expect(message).toMatchObject({
			type: "event",
			envelope: { seq: 4, event: { type: "error", retryable: false, error: { code: "unknown" } } },
		});
		expect(log.errors).toHaveLength(1);
	});
});
