/**
 * The mapping's test kit: plays frames through the real mapper the way a host does (a run opens when the CLI says
 * `running` and ends at `idle`, settling what is open), and checks each stream against the contract's rules.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_CODE_MAPPING } from "../../../backends/claude-code/mapping";
import { createFrameMapper } from "../../../backends/claude-code/mapping/mapper";
import type { FrameMapper, MappedEvent } from "../../../backends/claude-code/ports/mapping";
import { CLAUDE_CODE_TRAITS } from "../../../backends/claude-code/traits";
import {
	type AgentEvent,
	AgentEvent as AgentEventSchema,
	applyEvent,
	emptySnapshot,
	type RunOutcome,
	type SinkRecord,
} from "../../../contract";
import { streamViolations, unsettledParts } from "../../../contract/testing/stream-rules";
import { readFrameFixture } from "../helpers/frame-fixtures";

export const SESSION_ID = "11111111-2222-4333-8444-555555555555";
export const NOW = 1_800_000_000_000;

/** A frame as a plain value; the mapper reads frames only. */
export function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return value;
}

export function newMapper(now: () => number = () => NOW): FrameMapper {
	return createFrameMapper({ sessionId: SESSION_ID }, now);
}

interface Wire {
	readonly type: string;
	readonly subtype?: unknown;
	readonly state?: unknown;
}

function stateOf(frame: SDKMessage): "running" | "idle" | undefined {
	const wire: Wire = frame;
	if (wire.type !== "system" || wire.subtype !== "session_state_changed") return undefined;
	return wire.state === "running" || wire.state === "idle" ? wire.state : undefined;
}

export interface Played {
	/** Every mapped event with the run events a host adds, per stream (`""` is the main stream, else an agent id). */
	readonly streams: Map<string, AgentEvent[]>;
	readonly mapped: MappedEvent[];
}

const COMPLETED: RunOutcome = { kind: "completed" };

/** What a host does around the mapper: `running` opens a run, `idle` settles and closes it with the last result's outcome. */
export function play(frames: readonly SDKMessage[], mapper: FrameMapper = newMapper()): Played {
	const streams = new Map<string, AgentEvent[]>();
	const mapped: MappedEvent[] = [];
	const runs = new Map<string, string>();
	let runNumber = 0;
	let outcome = COMPLETED;
	const push = (stream: string, event: AgentEvent): void => {
		streams.set(stream, [...(streams.get(stream) ?? []), event]);
	};
	const open = (stream: string): void => {
		if (runs.has(stream)) return;
		runNumber += 1;
		runs.set(stream, `run-${runNumber}`);
		push(stream, { type: "run_started", runId: `run-${runNumber}`, trigger: "prompt" });
	};
	const take = (events: readonly MappedEvent[]): void => {
		for (const item of events) {
			const stream = item.agentId ?? "";
			open(stream);
			push(stream, item.event);
			mapped.push(item);
		}
	};
	const close = (): void => {
		take(mapper.settle(outcome.kind === "aborted" ? "aborted" : "completed"));
		for (const [stream, runId] of runs) {
			push(stream, { type: "run_finished", runId, outcome: stream === "" ? outcome : COMPLETED });
		}
		runs.clear();
		outcome = COMPLETED;
	};
	for (const frame of frames) {
		const state = stateOf(frame);
		if (state === "running") open("");
		if (state === "idle") {
			close();
			continue;
		}
		if (frame.type === "result") outcome = CLAUDE_CODE_MAPPING.turnOutcome(frame);
		take(mapper.map(frame));
	}
	if (runs.size > 0) close();
	return { streams, mapped };
}

export function playFixture(scenario: string): Played {
	return play(readFrameFixture(scenario));
}

export function recordsOf(events: readonly AgentEvent[]): SinkRecord[] {
	return events.map((event, index) => ({ at: NOW + index, event }));
}

/** Every rule the contract's stream checker has, over each stream, with the traits Claude Code declares. */
export function violationsOf(played: Played): string[] {
	return [...played.streams].flatMap(([stream, events]) => {
		const records = recordsOf(events);
		return [
			...streamViolations(records, CLAUDE_CODE_TRAITS, emptySnapshot()),
			...unsettledParts(records, emptySnapshot()),
		].map((problem) => `${stream === "" ? "main" : stream}: ${problem}`);
	});
}

/** Each event is a valid contract event (every bound the schema has). */
export function schemaProblems(played: Played): string[] {
	return played.mapped.flatMap((item, index) => {
		const parsed = AgentEventSchema.safeParse(item.event);
		return parsed.success ? [] : [`#${index} ${item.event.type}: ${parsed.error.message}`];
	});
}

function labelOf(event: AgentEvent): string {
	switch (event.type) {
		case "block_started":
			return `block_started:${event.kind}${event.parentToolCallId === undefined ? "" : "^"}`;
		case "tool_started":
			return `tool_started${event.parentToolCallId === undefined ? "" : "^"}`;
		case "tool_updated":
			return `tool_updated:${event.update.kind}`;
		case "tool_finished":
			return `tool_finished:${event.outcome}`;
		case "compaction_finished":
			return `compaction_finished:${event.outcome.kind}`;
		case "run_finished":
			return `run_finished:${event.outcome.kind}`;
		case "extension":
			return `extension:${event.extension.kind}`;
		case "notice":
			return `notice:${event.level}`;
		default:
			return event.type;
	}
}

/** The events as one line: `block_delta` runs collapsed (`block_delta*3`), tool and notice events labelled by kind. */
export function shapeOf(events: readonly AgentEvent[] | undefined): string {
	const parts: { label: string; count: number }[] = [];
	for (const event of events ?? []) {
		const label = labelOf(event);
		const last = parts[parts.length - 1];
		if (last !== undefined && last.label === label && label === "block_delta") last.count += 1;
		else parts.push({ label, count: 1 });
	}
	return parts.map(({ label, count }) => (count > 1 ? `${label}*${count}` : label)).join(" ");
}

/** The state a snapshot reaches by applying the events, for assertions on what a viewer would see. */
export function snapshotOf(events: readonly AgentEvent[]) {
	return events.reduce((snapshot, event, index) => applyEvent(snapshot, { at: NOW + index, event }), emptySnapshot());
}

export function ofType<T extends AgentEvent["type"]>(events: readonly AgentEvent[] | undefined, type: T) {
	return (events ?? []).filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}
