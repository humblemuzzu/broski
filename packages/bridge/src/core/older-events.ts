/** The events a client of an older minor is sent in place of what a later minor added (contract README §12.4). */

import { ADDED_IN_MINOR, type AgentEvent, type EventEnvelope, MAX_TEXT_CHARS, type SessionSnapshot } from "../contract";
import type { EncodedFrame } from "./frame";
import type { CoreLog } from "./ports";
import { fitEvent } from "./wire-fit";

/** The event a client below `minor` is sent, and the live state after it as that client may know it. */
interface OlderView {
	readonly minor: number;
	readonly event: AgentEvent;
	readonly after: SessionSnapshot;
}

/**
 * `frame` for the event in `envelope`, with the frames older clients are sent instead, newest minor first: each client
 * gets the first one its minor speaks (`CoreClient.send`). Every stand-in keeps the event's `seq`, so the stream stays
 * gapless for every client.
 */
export function withOlderView(
	frame: EncodedFrame,
	envelope: EventEnvelope,
	after: SessionSnapshot,
	maxBytes: number,
	log: CoreLog,
): EncodedFrame {
	let chain: EncodedFrame["instead"];
	for (const view of olderViews(envelope.event, after).reverse()) {
		const fitted = fitEvent({ ...envelope, event: view.event }, view.after, maxBytes, log);
		chain = { minor: view.minor, frame: chain ? { ...fitted, instead: chain } : fitted };
	}
	return chain ? { ...frame, instead: chain } : frame;
}

/**
 * Newest minor first. 1.4: a prompt suggestion becomes an info `notice` with its text. 1.2: `input_returned` becomes a
 * `notice` carrying the same texts. None of these events is state, so an older client's live state is the same.
 */
function olderViews(event: AgentEvent, after: SessionSnapshot): OlderView[] {
	const views: OlderView[] = [];
	const before14 = eventBefore14(event);
	if (before14 !== event) views.push({ minor: ADDED_IN_MINOR.configOps, event: before14, after });
	if (before14.type === "input_returned") {
		views.push({ minor: ADDED_IN_MINOR.inputReturned, event: notice(returnedText(before14.texts)), after });
	}
	return views;
}

/** `event` without what 1.4 added; the same object when it has none. */
function eventBefore14(event: AgentEvent): AgentEvent {
	if (event.type === "extension" && event.extension.kind === "prompt_suggestion") {
		return notice(clipped(`${SUGGESTION_HEADING} ${event.extension.text}`));
	}
	return event;
}

const RETURNED_HEADING = "Not sent. These were queued when the run was stopped:";
const SUGGESTION_HEADING = "Suggested next prompt:";

function notice(text: string): AgentEvent {
	return { type: "notice", level: "info", text };
}

function returnedText(texts: readonly string[]): string {
	return clipped(`${RETURNED_HEADING}\n\n${texts.join("\n\n")}`);
}

/** `text` within the contract's text bound, never cut inside a surrogate pair. */
function clipped(text: string): string {
	if (text.length <= MAX_TEXT_CHARS) return text;
	const cut = text.slice(0, MAX_TEXT_CHARS);
	const last = cut.charCodeAt(cut.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
