import { type EventEnvelope, type JsonValue, ServerMessage, SessionSnapshot } from "../contract";
import { type EncodedFrame, encodeFrame } from "./frame";
import type { CoreLog } from "./ports";
import { withoutOldestItems } from "./snapshot-fit";
import { type ElisionScope, elide, type JsonPath } from "./text-elision";

/**
 * The frame of `message` within `maxBytes`, the largest frame the link carries whole, never cut
 * mid-JSON. Past the cap, a snapshot sheds its run's oldest items (`droppedItems`) when that alone
 * makes it fit. Otherwise the rest of the message is over the cap by itself, so free text is cut
 * (`elide`) with every item kept, and items are shed only when even text at its floor does not fit.
 * Undefined when nothing fits.
 */
export function fitMessage(message: ServerMessage, maxBytes: number, log: CoreLog): EncodedFrame | undefined {
	const frame = encodeFrame(message);
	if (frame.bytes <= maxBytes) return frame;
	const trimmed = withoutOldestRunItems(message, maxBytes);
	if (trimmed === message) return elided(message, maxBytes, log);
	const trimmedFrame = encodeFrame(trimmed);
	if (trimmedFrame.bytes <= maxBytes) return trimmedFrame;
	return elided(message, maxBytes, log) ?? elided(trimmed, maxBytes, log);
}

/**
 * The frame every viewer and the log get for one event; it always fits. An event that does not fit
 * even shortened is replaced by `resynced` with the live state after it, and when not even that fits,
 * by an `error` event saying what was left out.
 */
export function fitEvent(
	envelope: EventEnvelope,
	after: SessionSnapshot,
	maxBytes: number,
	log: CoreLog,
): EncodedFrame {
	const frame = fitMessage({ type: "event", envelope }, maxBytes, log);
	if (frame) return frame;
	const { native: _native, ...plain } = envelope;
	if (SessionSnapshot.safeParse(after).success) {
		const resync = fitMessage(
			{ type: "event", envelope: { ...plain, event: { type: "resynced", snapshot: after } } },
			maxBytes,
			log,
		);
		if (resync) {
			log.info(`[core] ${envelope.event.type} #${envelope.seq} does not fit the link; sent as resynced`);
			return resync;
		}
	}
	const bytes = encodeFrame({ type: "event", envelope }).bytes;
	log.error(
		`[core] ${envelope.event.type} #${envelope.seq} (${bytes} bytes) does not fit the link (${maxBytes}); left out`,
	);
	const message = `The bridge left out a ${envelope.event.type} update of ${bytes} bytes; the link carries at most ${maxBytes}.`;
	return encodeFrame({
		type: "event",
		envelope: { ...plain, event: { type: "error", error: { code: "unknown", message }, retryable: false } },
	});
}

function withoutOldestRunItems(message: ServerMessage, maxBytes: number): ServerMessage {
	if (message.type === "session.attach.result" && message.sync.kind === "snapshot") {
		const sync = message.sync;
		const snapshot = withoutOldestItems(
			sync.snapshot,
			(candidate) => encodeFrame({ ...message, sync: { ...sync, snapshot: candidate } }).bytes,
			maxBytes,
		);
		return snapshot === sync.snapshot ? message : { ...message, sync: { ...sync, snapshot } };
	}
	if (message.type === "event" && message.envelope.event.type === "resynced") {
		const envelope = message.envelope;
		const resynced = message.envelope.event;
		const snapshot = withoutOldestItems(
			resynced.snapshot,
			(candidate) =>
				encodeFrame({ type: "event", envelope: { ...envelope, event: { ...resynced, snapshot: candidate } } }).bytes,
			maxBytes,
		);
		return snapshot === resynced.snapshot
			? message
			: { type: "event", envelope: { ...envelope, event: { ...resynced, snapshot } } };
	}
	return message;
}

function elided(message: ServerMessage, maxBytes: number, log: CoreLog): EncodedFrame | undefined {
	const scope = elisionScope(message);
	if (!scope) return undefined;
	const tree: JsonValue = JSON.parse(JSON.stringify(message));
	if (!elide(tree, scope, (candidate) => encodeFrame(candidate).bytes - maxBytes)) return undefined;
	const checked = ServerMessage.safeParse(tree);
	if (!checked.success) {
		log.error(`[core] a shortened ${message.type} broke the contract: ${checked.error.message}`);
		return undefined;
	}
	return encodeFrame(tree);
}

/**
 * What may be shortened in each message: free text, never cursors, image bytes, a file's content, a diff's
 * lines or terminal output, whose answers are read smaller instead (`pageWithinFrame`) or bounded to fit.
 */
function elisionScope(message: ServerMessage): ElisionScope | undefined {
	switch (message.type) {
		case "event":
			return snapshotScope(["envelope", "event"], ["envelope", "event", "snapshot"]);
		case "session.attach.result":
			return snapshotScope(["sync", "snapshot"], ["sync", "snapshot"]);
		case "catalog":
			return headScope(["event"]);
		case "sessions.list.result":
		case "transcript.read.result":
			return headScope(["result", "page", "items"]);
		case "backend.status.result":
			return headScope(["status"]);
		case "attachment.read.result":
		case "fs.read.result":
		case "fs.image.result":
		case "git.diff.result":
		case "term.attach.result":
			return undefined;
		default:
			return "result" in message ? headScope(["result"]) : undefined;
	}
}

function headScope(root: JsonPath): ElisionScope {
	return { roots: [root], keepsTail: () => false };
}

/** An open block's text and a running tool's output keep their newest part: the deltas that follow extend it. */
function snapshotScope(root: JsonPath, snapshot: JsonPath): ElisionScope {
	return {
		roots: [root],
		keepsTail: (path) =>
			path.length === snapshot.length + 3 &&
			snapshot.every((segment, index) => path[index] === segment) &&
			((path[snapshot.length] === "blocks" && path[snapshot.length + 2] === "text") ||
				(path[snapshot.length] === "tools" && path[snapshot.length + 2] === "output")),
	};
}
