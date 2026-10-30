/**
 * The mapping against the pinned SDK: a real `AgentSession` on the faux provider runs, and its real events go
 * through the mapping. The stream must obey the contract's rules, and what the run showed live must be
 * what the session file shows afterwards.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, JsonObject } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { storedToolCallId, ToolCallIds } from "../../backends/pi/ids";
import { boundedJson } from "../../backends/pi/json";
import { runOutcome } from "../../backends/pi/mapping/errors";
import { itemsOfEntry } from "../../backends/pi/mapping/message-items";
import { AssistantStream } from "../../backends/pi/mapping/stream-blocks";
import {
	fileChangesOf,
	toolFinished,
	toolOutcome,
	toolOutputOf,
	toolResultOf,
	toolStartedOfExecution,
} from "../../backends/pi/mapping/tool-items";
import { PI_TRAITS } from "../../backends/pi/traits";
import {
	type AgentEvent,
	applyEvent,
	emptySnapshot,
	type JsonValue,
	type SinkRecord,
	type TranscriptItem,
	TranscriptItem as TranscriptItemSchema,
} from "../../contract";
import { streamViolations, unsettledParts } from "../../contract/testing/stream-rules";
import { hostSpikeSession, silentUi, spikeRuntimeFactory } from "./helpers/pi-spike";
import { createPiTestEnv, createTestModelRuntime, type PiTestEnv, registerFaux } from "./helpers/pi-test-env";
import { deepFreeze, records, validEvents } from "./mapping_fixtures";

let env: PiTestEnv;
let runtime: AgentSessionRuntime | undefined;

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	env.dispose();
});

/** What the event bridge does with the events the mapping maps, reduced to those. */
class Recorder {
	readonly events: AgentEvent[] = [];
	/** The types of Pi events the mapping changed while it read them: there must be none. */
	readonly mutated: string[] = [];
	private readonly tools = new ToolCallIds();
	private stream: AssistantStream | undefined;
	private count = 0;
	private last: AssistantMessage | undefined;
	private readonly inputs = new Map<string, JsonValue>();

	constructor(session: AgentSession) {
		session.subscribe((event) => this.onEvent(event));
	}

	private onEvent(event: AgentSessionEvent): void {
		const before = JSON.stringify(event);
		this.map(event);
		if (JSON.stringify(event) !== before) this.mutated.push(event.type);
	}

	private map(event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				this.events.push({ type: "run_started", runId: "run-1", trigger: "prompt" });
				break;
			case "message_start":
				if (event.message.role !== "assistant") break;
				this.tools.nextResponse();
				this.count += 1;
				this.stream = new AssistantStream(`msg-${this.count}`, this.tools);
				break;
			case "message_update":
				this.events.push(...(this.stream?.update(event.assistantMessageEvent) ?? []));
				break;
			case "message_end":
				this.onMessageEnd(event.message);
				break;
			case "tool_execution_start":
				this.inputs.set(event.toolCallId, boundedJson(event.args));
				if (!this.tools.find(event.toolCallId)) this.events.push(toolStartedOfExecution(event, this.tools));
				break;
			case "tool_execution_update":
				this.events.push(toolOutputOf(event, this.tools));
				break;
			case "agent_settled":
				this.events.push({ type: "run_finished", runId: "run-1", outcome: runOutcome(this.last, event.aborted) });
				break;
			default:
				break;
		}
	}

	private onMessageEnd(message: AgentMessage): void {
		if (message.role === "assistant") {
			this.last = message;
			this.events.push(...(this.stream?.end(message) ?? []));
			for (const id of this.stream?.unexecutedCalls(message) ?? []) {
				this.events.push({
					type: "tool_finished",
					toolCallId: id,
					outcome: "aborted",
					result: { content: [], fileChanges: [] },
				});
			}
		} else if (message.role === "toolResult") {
			const changes = fileChangesOf(
				message.toolName,
				this.inputs.get(message.toolCallId) ?? null,
				message.details === undefined ? undefined : boundedJson(message.details),
			);
			const outcome = toolOutcome({ isError: message.isError, denied: false, aborted: false });
			const result = toolResultOf(message.content, message.isError, changes, () => undefined);
			this.events.push(toolFinished(message.toolCallId, outcome, result, this.tools));
		}
	}
}

async function host(): Promise<{ session: AgentSession; recorder: Recorder; script: (r: AssistantMessage[]) => void }> {
	const modelRuntime = await createTestModelRuntime(env);
	const faux = await registerFaux(modelRuntime, [{ id: "m1", reasoning: true }]);
	runtime = await hostSpikeSession(env, spikeRuntimeFactory(modelRuntime, faux.handle.getModel(), []));
	await runtime.session.bindExtensions({ uiContext: silentUi(), mode: "rpc" });
	return {
		session: runtime.session,
		recorder: new Recorder(runtime.session),
		script: (responses) => faux.handle.setResponses(responses),
	};
}

function check(recorder: Recorder): SinkRecord[] {
	expect(recorder.mutated).toEqual([]);
	const recorded = records(validEvents(recorder.events));
	expect(streamViolations(recorded, PI_TRAITS, emptySnapshot())).toEqual([]);
	expect(unsettledParts(recorded, emptySnapshot())).toEqual([]);
	return recorded;
}

/** The items the stored branch gives, the way the store hands them to the mapping. */
function storedItems(session: AgentSession): TranscriptItem[] {
	const calls = new Map<string, { id: string; input: JsonObject }>();
	const items: TranscriptItem[] = [];
	for (const entry of session.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			entry.message.content.forEach((block, index) => {
				if (block.type === "toolCall")
					calls.set(block.id, { id: storedToolCallId(entry.id, index), input: block.arguments });
			});
		}
		const call =
			entry.type === "message" && entry.message.role === "toolResult" ? calls.get(entry.message.toolCallId) : undefined;
		const context = call ? { toolCallId: call.id, toolInput: call.input } : {};
		items.push(...itemsOfEntry(deepFreeze(structuredClone(entry)), context));
	}
	return items.map((item) => TranscriptItemSchema.parse(item));
}

/** Items without ids and times, the part live and stored must agree on. */
function shape(items: readonly TranscriptItem[]): Record<string, unknown>[] {
	return items.flatMap((item): Record<string, unknown>[] => {
		switch (item.kind) {
			case "block":
				return [{ kind: item.kind, block: item.block, text: item.text }];
			case "tool_call":
				return [{ kind: item.kind, name: item.name, input: item.input }];
			case "tool_result":
				return [{ kind: item.kind, outcome: item.outcome, result: item.result }];
			default:
				return [];
		}
	});
}

function liveItems(recorded: readonly SinkRecord[]): TranscriptItem[] {
	const beforeFinish = recorded.slice(0, -1);
	return beforeFinish.reduce((snapshot, record) => applyEvent(snapshot, record), emptySnapshot()).run?.items ?? [];
}

describe("a run on the real SDK", () => {
	test("thinking, text and a read tool: the stream is valid and the stored branch shows the same items", async () => {
		const { session, recorder, script } = await host();
		script([
			fauxAssistantMessage(
				[fauxThinking("looking"), fauxText("Reading"), fauxToolCall("read", { path: "README.md" })],
				{
					stopReason: "toolUse",
				},
			),
			fauxAssistantMessage("It says Project."),
		]);
		await session.prompt("go", { expandPromptTemplates: false });
		await session.waitForIdle();
		const recorded = check(recorder);
		expect(recorded.at(-1)?.event).toEqual({ type: "run_finished", runId: "run-1", outcome: { kind: "completed" } });
		const live = shape(liveItems(recorded));
		expect(live.map((item) => item.kind)).toEqual(["block", "block", "tool_call", "tool_result", "block"]);
		const stored = storedItems(session);
		expect(shape(stored)).toEqual(live);
		const calls = stored.flatMap((item) => (item.kind === "tool_call" ? [item.toolCallId] : []));
		const answered = stored.flatMap((item) => (item.kind === "tool_result" ? [item.toolCallId] : []));
		expect(answered).toEqual(calls);
		expect(new Set(stored.map((item) => item.id)).size).toBe(stored.length);
	});

	test("edit: the file change is the unified patch of the real tool, the same live and stored", async () => {
		const { session, recorder, script } = await host();
		script([
			fauxAssistantMessage(
				[
					fauxToolCall("edit", {
						path: "README.md",
						edits: [{ oldText: "A file the tests point at.", newText: "A file the tests changed." }],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Edited."),
		]);
		await session.prompt("edit it", { expandPromptTemplates: false });
		await session.waitForIdle();
		expect(readFileSync(join(env.cwd, "README.md"), "utf8")).toContain("changed");
		const recorded = check(recorder);
		const result = liveItems(recorded).find((item) => item.kind === "tool_result");
		const change = result?.kind === "tool_result" ? result.result.fileChanges[0] : undefined;
		expect(change).toMatchObject({ path: "README.md", change: "modified", additions: 1, deletions: 1 });
		expect(change?.diff).toContain("+A file the tests changed.");
		expect(change?.diff?.startsWith("--- README.md\n+++ README.md\n@@")).toBe(true);
		expect(shape(storedItems(session))).toEqual(shape(liveItems(recorded)));
	});

	test("a write names its path; a failed read is an error with no changes", async () => {
		const { session, recorder, script } = await host();
		script([
			fauxAssistantMessage(
				[fauxToolCall("write", { path: "new.txt", content: "hello" }), fauxToolCall("read", { path: "missing.txt" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);
		await session.prompt("write and read", { expandPromptTemplates: false });
		await session.waitForIdle();
		const finished = check(recorder).flatMap((record) => (record.event.type === "tool_finished" ? [record.event] : []));
		expect(finished).toHaveLength(2);
		const write = finished.find((event) => event.outcome === "completed");
		const read = finished.find((event) => event.outcome === "failed");
		expect(write?.result.fileChanges).toEqual([{ path: "new.txt", change: "modified" }]);
		expect(read?.result).toMatchObject({ content: [], fileChanges: [] });
		expect(read?.result.error).toContain("missing.txt");
		expect(shape(storedItems(session))).toEqual(shape(liveItems(check(recorder))));
	});

	test("a call whose arguments fail validation still reports them as its input and ends failed", async () => {
		const { session, recorder, script } = await host();
		script([fauxAssistantMessage([fauxToolCall("read", {})], { stopReason: "toolUse" }), fauxAssistantMessage("Oh.")]);
		await session.prompt("bad call", { expandPromptTemplates: false });
		await session.waitForIdle();
		const recorded = check(recorder);
		const events = recorded.map((record) => record.event);
		expect(events.find((event) => event.type === "tool_updated")).toMatchObject({
			update: { kind: "input", input: {} },
		});
		expect(events.find((event) => event.type === "tool_finished")).toMatchObject({ outcome: "failed" });
	});

	test("a length stop with a tool call: the call fails with Pi's synthetic error and the run goes on", async () => {
		const { session, recorder, script } = await host();
		script([
			fauxAssistantMessage([fauxText("cut"), fauxToolCall("read", { path: "README.md" })], { stopReason: "length" }),
			fauxAssistantMessage("Sorry."),
		]);
		await session.prompt("long", { expandPromptTemplates: false });
		await session.waitForIdle();
		const recorded = check(recorder);
		const finished = recorded.flatMap((record) => (record.event.type === "tool_finished" ? [record.event] : []));
		expect(finished).toHaveLength(1);
		expect(finished[0]).toMatchObject({ outcome: "failed" });
		expect(finished[0]?.result.error).toContain("output token limit");
		expect(recorded.at(-1)?.event).toMatchObject({ outcome: { kind: "completed" } });
		expect(shape(storedItems(session))).toEqual(shape(liveItems(recorded)));
	});

	test("a message that fails after starting a call runs none: the stream names the call, and finishing it aborted is enough", async () => {
		const { session, recorder, script } = await host();
		script([
			fauxAssistantMessage([fauxText("trying"), fauxToolCall("read", { path: "README.md" })], {
				stopReason: "error",
				errorMessage: "Boom from the provider",
			}),
		]);
		let executions = 0;
		session.subscribe((event) => {
			if (event.type === "tool_execution_start") executions += 1;
		});
		await session.prompt("fail mid call", { expandPromptTemplates: false });
		await session.waitForIdle();
		const recorded = check(recorder);
		const events = recorded.map((record) => record.event);
		expect(events.some((event) => event.type === "tool_started")).toBe(true);
		expect(events.filter((event) => event.type === "tool_finished")).toMatchObject([{ outcome: "aborted" }]);
		expect(executions).toBe(0);
	});

	test("a provider error ends the run as an error carrying the provider's text", async () => {
		const { session, recorder, script } = await host();
		script([fauxAssistantMessage([], { stopReason: "error", errorMessage: "Boom from the provider" })]);
		await session.prompt("fail", { expandPromptTemplates: false });
		await session.waitForIdle();
		const recorded = check(recorder);
		expect(recorded.at(-1)?.event).toEqual({
			type: "run_finished",
			runId: "run-1",
			outcome: { kind: "error", error: { code: "unknown", message: "Boom from the provider" } },
		});
	});
});
