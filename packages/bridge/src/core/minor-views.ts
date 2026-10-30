/** What a client of an older minor is told in place of what a later minor added (contract README §12.4). */

import {
	ADDED_IN_MINOR,
	type BackendDescriptor,
	type BackendOpKind,
	type EventEnvelope,
	MAX_TEXT_CHARS,
	type SessionCapabilities,
	type SessionSnapshot,
} from "../contract";
import type { CoreClient } from "./client";
import type { EncodedFrame } from "./frame";
import type { CoreLog } from "./ports";
import { fitEvent } from "./wire-fit";

const OPS_ADDED: readonly (readonly [minor: number, ops: readonly BackendOpKind[]])[] = [
	[ADDED_IN_MINOR.takeOver, ["take_over"]],
	[ADDED_IN_MINOR.sessionControls, ["session_settings", "session_tools", "system_prompt"]],
];

/** The descriptor as `client` may know it: without the ops a later minor added. */
export function descriptorFor(client: CoreClient, descriptor: BackendDescriptor): BackendDescriptor {
	const unknown = OPS_ADDED.filter(([minor]) => !client.speaks(minor)).flatMap(([, ops]) => ops);
	if (unknown.length === 0) return descriptor;
	const backendOps = descriptor.capabilities.backendOps.filter((op) => !unknown.includes(op));
	return { ...descriptor, capabilities: { ...descriptor.capabilities, backendOps } };
}

/** A session's capabilities as `client` may know them: without the fields a later minor added. */
export function capabilitiesFor(client: CoreClient, capabilities: SessionCapabilities): SessionCapabilities {
	if (client.speaks(ADDED_IN_MINOR.sessionControls)) return capabilities;
	const { cancelCompaction: _compaction, cancelRetry: _retry, ...older } = capabilities;
	return older;
}

/**
 * `frame` for the event in `envelope`, with the frame an older client is sent instead when the event is one a later
 * minor added: `input_returned` becomes a `notice` carrying the same texts, with the same `seq`, so the stream stays
 * gapless. Neither event is state, so the older client's live state is the same.
 */
export function withOlderView(
	frame: EncodedFrame,
	envelope: EventEnvelope,
	after: SessionSnapshot,
	maxBytes: number,
	log: CoreLog,
): EncodedFrame {
	const { event } = envelope;
	if (event.type !== "input_returned") return frame;
	const notice = { type: "notice", level: "info", text: returnedText(event.texts) } as const;
	const instead = fitEvent({ ...envelope, event: notice }, after, maxBytes, log);
	return { ...frame, instead: { minor: ADDED_IN_MINOR.inputReturned, frame: instead } };
}

const RETURNED_HEADING = "Not sent. These were queued when the run was stopped:";

function returnedText(texts: readonly string[]): string {
	const text = `${RETURNED_HEADING}\n\n${texts.join("\n\n")}`;
	if (text.length <= MAX_TEXT_CHARS) return text;
	const cut = text.slice(0, MAX_TEXT_CHARS);
	const last = cut.charCodeAt(cut.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
