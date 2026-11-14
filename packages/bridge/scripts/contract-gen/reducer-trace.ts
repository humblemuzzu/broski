import {
	AgentEvent,
	type AgentEvent as AgentEventType,
	applyEvent,
	type JsonValue,
	MAX_TEXT_CHARS,
	type ServerMessage,
	SessionSnapshot,
	type SessionStatus,
	sessionStatus,
	type Timestamp,
} from "../../src/contract";
import { canonicalJson, sha256Hex } from "./canonical-json";
import { compactLongStrings } from "./fixture-text";
import { type ReducerCase, reducerCases } from "./reducer-cases";

/** A step's expected snapshot is written whole up to this many characters of fixture, else as a hash. */
const WHOLE_EXPECTATION_CHARS = 4_096;
const FIRST_AT = 1_000;

interface TraceRecord {
	readonly at: Timestamp;
	readonly event: AgentEventType;
}

/**
 * The reducer's executable meaning, written out for the app to replay: for each case a starting
 * snapshot and every event, each with the snapshot and status `applyEvent` and `sessionStatus`
 * give after it. A small snapshot is written whole; a large one as the SHA-256 of its canonical
 * JSON. Long strings are written as runs (`fixture-text.ts`).
 */
export function reducerTrace(stream: readonly ServerMessage[]): { cases: JsonValue[] } {
	const cases = [fakeSessionCase(stream), ...reducerCases().map(timed)];
	const traced = cases.map(({ name, initial, records }) => traceCase(name, initial, records));
	assertCoverage(cases);
	return { cases: traced };
}

function timed(input: ReducerCase): { name: string; initial: SessionSnapshot; records: TraceRecord[] } {
	return {
		name: input.name,
		initial: input.initial,
		records: input.events.map((event, index) => ({ at: FIRST_AT + index, event })),
	};
}

/** The fake session the app's round-trip test decodes, as one stream applied to its attach snapshot. */
function fakeSessionCase(stream: readonly ServerMessage[]) {
	const [attach] = stream;
	if (attach?.type !== "session.attach.result" || attach.sync.kind !== "snapshot") {
		throw new Error("the fake session stream starts with a snapshot attach");
	}
	const records = stream.flatMap((message) =>
		message.type === "event" ? [{ at: message.envelope.at, event: message.envelope.event }] : [],
	);
	return { name: "the fake backend's scripted session", initial: attach.sync.snapshot, records };
}

function traceCase(name: string, initial: SessionSnapshot, records: readonly TraceRecord[]): JsonValue {
	let snapshot = SessionSnapshot.parse(initial);
	const steps = records.map((record) => {
		AgentEvent.parse(record.event);
		snapshot = SessionSnapshot.parse(applyEvent(snapshot, record));
		return {
			record: compactLongStrings(asJson(record)),
			status: sessionStatus(snapshot),
			...expectation(asJson(snapshot)),
		};
	});
	return { name, initial: compactLongStrings(asJson(initial)), steps };
}

function expectation(snapshot: JsonValue): { expected: JsonValue } | { expectedSha256: string } {
	const whole = compactLongStrings(snapshot);
	if (JSON.stringify(whole).length <= WHOLE_EXPECTATION_CHARS) return { expected: whole };
	return { expectedSha256: sha256Hex(canonicalJson(snapshot)) };
}

/** The value as the wire carries it. */
function asJson(value: object): JsonValue {
	return JSON.parse(JSON.stringify(value));
}

/** The trace must reach every event kind, every status, the item bound and both text-cap trims. */
function assertCoverage(cases: readonly { initial: SessionSnapshot; records: TraceRecord[] }[]): void {
	const types = new Set<string>();
	const updates = new Set<string>();
	const statuses = new Set<SessionStatus>();
	let dropped = false;
	let trimmedInsidePair = false;
	for (const { initial, records } of cases) {
		let snapshot = initial;
		for (const record of records) {
			types.add(record.event.type);
			if (record.event.type === "tool_updated") updates.add(record.event.update.kind);
			snapshot = applyEvent(snapshot, record);
			statuses.add(sessionStatus(snapshot));
			dropped ||= (snapshot.run?.droppedItems ?? 0) > 0;
			trimmedInsidePair ||= snapshot.blocks.some((block) => block.text.length === MAX_TEXT_CHARS - 1);
		}
	}
	const missing = [
		...AgentEvent.options.map((option) => option.shape.type.value).filter((type) => !types.has(type)),
		...["input", "output_appended", "output_replaced", "progress", "file_changes", "child_session"].filter(
			(kind) => !updates.has(kind),
		),
		...(["idle", "running", "waiting_for_user"] as const).filter((status) => !statuses.has(status)),
		...(dropped ? [] : ["droppedItems"]),
		...(trimmedInsidePair ? [] : ["a trim inside a surrogate pair"]),
	];
	if (missing.length > 0) throw new Error(`the reducer trace never reaches: ${missing.join(", ")}`);
}
