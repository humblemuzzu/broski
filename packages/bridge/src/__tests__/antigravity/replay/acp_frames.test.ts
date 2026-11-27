/**
 * Every record agy wrote in the recordings (`recordings.ts`), each `agy` process played to the bridge's JSON-RPC layer
 * by a client that says exactly what the bridge said there: through the JSONL framing, each answer read by the schema
 * the bridge reads that method's answer with, each `session/update` to its session's route, each of agy's requests to
 * its session as a call. None is a fault, none passes as a kind the bridge does not read, and no list item or field
 * the readers name is dropped.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { type JsonlItem, JsonlSplitter } from "../../../adapter-kit/jsonl";
import {
	AnyResult,
	ElicitationRequest,
	InitializeResult,
	ListSessionsResult,
	LoadSessionResult,
	NewSessionResult,
	PermissionRequest,
	PromptResult,
	SessionUpdate,
	SetConfigOptionResult,
} from "../../../backends/antigravity/acp/frames";
import type { AgentCall, RpcResult } from "../../../backends/antigravity/acp/rpc";
import type { Frame } from "../live/wire-log";
import type { RecordedAgy } from "../record/scrub";
import { type Recording, recording, SCENARIOS } from "./recordings";
import { isAnswer, Replay } from "./replay";

type Message = Frame["message"];

/** The reader each answer goes through in the bridge (`session/load`'s the host's, the stricter of its two). */
const ANSWERS: Readonly<Record<string, z.ZodType>> = {
	initialize: InitializeResult,
	"session/new": NewSessionResult,
	"session/load": LoadSessionResult,
	"session/list": ListSessionsResult,
	"session/set_config_option": SetConfigOptionResult,
	"session/prompt": PromptResult,
	"session/close": AnyResult,
};

const CALLS: Readonly<Record<string, z.ZodType>> = {
	"session/request_permission": PermissionRequest,
	"elicitation/create": ElicitationRequest,
};

const recordings: Recording[] = SCENARIOS.map((scenario) => recording(scenario));

function agentFrames(agy: RecordedAgy): Message[] {
	return agy.frames.filter((frame) => frame.from === "agent").map((frame) => frame.message);
}

function sessionIdsOf(agy: RecordedAgy): Set<string> {
	const ids = agy.frames.flatMap(({ message }) =>
		[message.params, message.result].flatMap((body) =>
			isRecord(body) && typeof body.sessionId === "string" ? [body.sessionId] : [],
		),
	);
	return new Set(ids);
}

/** What `parsed`, read from `raw` by `schema`, lost of it: a list item, or a field the reader names. */
function dropped(raw: unknown, parsed: unknown, schema?: z.ZodType, at = ""): string[] {
	if (Array.isArray(parsed)) {
		if (!Array.isArray(raw)) return [];
		if (parsed.length !== raw.length) return [`${at}: ${parsed.length} of ${raw.length} items read`];
		return parsed.flatMap((item, index) => dropped(raw[index], item, undefined, `${at}[${index}]`));
	}
	if (!isRecord(parsed) || !isRecord(raw)) return [];
	const shape: Readonly<Record<string, z.ZodType>> = schema instanceof z.ZodObject ? schema.shape : {};
	const lost = Object.keys(shape)
		.filter((key) => raw[key] != null && parsed[key] === undefined)
		.map((key) => `${at}.${key}: not read`);
	return [...lost, ...Object.keys(parsed).flatMap((key) => dropped(raw[key], parsed[key], shape[key], `${at}.${key}`))];
}

function updateSchema(update: Readonly<Record<string, unknown>>): z.ZodType | undefined {
	return SessionUpdate.options.find((option) => option.shape.sessionUpdate.value === update.sessionUpdate);
}

/** One recorded `agy` to a client that sends what the bridge sent, answers agy's requests as it did, and reads it all. */
async function echoed(agy: RecordedAgy) {
	const replay = new Replay(agy);
	const updates: SessionUpdate[] = [];
	const calls: AgentCall[] = [];
	const unanswered: AgentCall[] = [];
	const faults = replay.faults;
	for (const sessionId of sessionIdsOf(agy)) {
		replay.rpc.attach(sessionId, {
			update: (update) => updates.push(update),
			call: (call) => {
				calls.push(call);
				unanswered.push(call);
			},
			fault: (message) => faults.push(`route: ${message}`),
		});
	}
	const asked: Array<{ readonly recorded: Message; readonly answer: Promise<RpcResult<unknown>> }> = [];
	await replay.play((recorded) => {
		const { method, params } = recorded;
		if (typeof method !== "string") unanswered.shift()?.answer.result(recorded.result);
		else if (recorded.id === undefined) replay.rpc.notify(method, params);
		else asked.push({ recorded, answer: replay.rpc.request(method, params, ANSWERS[method] ?? z.never()) });
	});
	const answers = await Promise.all(asked.map(async ({ recorded, answer }) => ({ recorded, read: await answer })));
	return { faults, unrecorded: replay.unrecorded(), updates, calls, answers };
}

/** What the client did not read of agy's records: one passed over, or a list item or field a reader dropped. */
function unread(agy: RecordedAgy, { updates, calls, answers }: Awaited<ReturnType<typeof echoed>>): string[] {
	const raw = agentFrames(agy);
	const notices = raw.filter((message) => typeof message.method === "string" && message.id === undefined);
	const rawUpdates = notices.flatMap((message) =>
		isRecord(message.params) && isRecord(message.params.update) ? [message.params.update] : [],
	);
	const rawCalls = raw.filter((message) => typeof message.method === "string" && message.id !== undefined);
	return [
		...notices.flatMap((message) => (message.method === "session/update" ? [] : [`passed over ${message.method}`])),
		...(updates.length === rawUpdates.length ? [] : [`${updates.length} of ${rawUpdates.length} updates routed`]),
		...rawUpdates.flatMap((update, index) =>
			dropped(update, updates[index], updateSchema(update), `update ${String(update.sessionUpdate)}`),
		),
		...(calls.length === rawCalls.length ? [] : [`${calls.length} of ${rawCalls.length} requests routed`]),
		...rawCalls.flatMap((message, index) =>
			dropped(message.params, calls[index]?.params, CALLS[String(message.method)], String(message.method)),
		),
		...answers.flatMap(({ recorded, read }) => {
			if (!read.ok) return [`${String(recorded.method)}: ${read.failure.message}`];
			const answer = raw.find((message) => isAnswer(message) && message.id === recorded.id);
			return dropped(answer?.result, read.result, ANSWERS[String(recorded.method)], String(recorded.method));
		}),
	];
}

describe("agy's recorded frames, read by the bridge's ACP client", () => {
	test("were all recorded on one agy", () => {
		expect(new Set(recordings.map((recorded) => recorded.agy)).size).toBe(1);
	});

	test("survive any cut of the byte stream into the JSONL framing", () => {
		const lines = recordings.flatMap((recorded) =>
			recorded.processes.flatMap((agy) => agentFrames(agy).map((message) => JSON.stringify(message))),
		);
		const bytes = new TextEncoder().encode(`${lines.join("\n")}\n`);
		const splitter = new JsonlSplitter();
		const items: JsonlItem[] = [];
		for (let at = 0; at < bytes.length; at += 7) items.push(...splitter.push(bytes.subarray(at, at + 7)));
		expect(items).toEqual(lines.map((text) => ({ kind: "line", text })));
	});

	for (const recorded of recordings) {
		test(`${recorded.scenario}: every record reads, as its kind, with nothing dropped and no fault`, async () => {
			for (const agy of recorded.processes) {
				const echo = await echoed(agy);
				expect(echo.faults).toEqual([]);
				expect(echo.unrecorded).toEqual([]);
				expect(unread(agy, echo)).toEqual([]);
			}
		});
	}
});
