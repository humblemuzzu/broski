/**
 * Retraction (idempotent, ids by message), and where a subagent's work goes (adapter README D20): its own stream, and
 * nested in the parent's.
 */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { assistant, ids, text, toolResult, toolUse, userText } from "./frames";
import { newMapper, ofType, play, shapeOf, snapshotOf, violationsOf } from "./helpers";

const fallback = (retracted: string[]): SDKMessage => ({
	type: "system",
	subtype: "model_refusal_fallback",
	trigger: "refusal",
	direction: "retry",
	original_model: "opus",
	fallback_model: "sonnet",
	request_id: null,
	content: "Retrying on sonnet.",
	retracted_message_uuids: retracted,
	...ids(),
});

describe("retraction", () => {
	test("a frame that supersedes earlier ones retracts their messages before it shows anything", () => {
		const refused = assistant("msg_A", [text("refused text")]);
		const replacement = assistant("msg_B", [text("better")], { supersedes: [refused.uuid] });
		const out = play([refused, replacement]).streams.get("");
		expect(shapeOf(out)).toBe(
			"run_started block_started:text block_finished messages_retracted block_started:text block_finished run_finished:completed",
		);
		expect(ofType(out, "messages_retracted")).toEqual([{ type: "messages_retracted", messageIds: ["msg_A"] }]);
	});

	test("the fallback notice's list does the same, and says so", () => {
		const refused = assistant("msg_A", [text("refused text")]);
		const out = play([refused, fallback([refused.uuid])]).streams.get("");
		expect(shapeOf(out)).toBe(
			"run_started block_started:text block_finished messages_retracted notice:warning run_finished:completed",
		);
	});

	test("the viewer's state loses the retracted message's blocks, calls and results", () => {
		const call = assistant("msg_A", [toolUse("toolu_1", "Bash", { command: "ls" })]);
		const out = play([
			call,
			toolResult("toolu_1", "files"),
			assistant("msg_B", [text("kept")], { supersedes: [call.uuid] }),
		])
			.streams.get("")
			?.filter((event) => event.type !== "run_finished");
		const items = snapshotOf(out ?? []).run?.items.map((item) => item.kind);
		expect(items).toEqual(["block"]);
	});

	test("is idempotent: a uuid already withdrawn, one never seen, and the message being delivered are no-ops", () => {
		const mapper = newMapper();
		const refused = assistant("msg_A", [text("a")]);
		mapper.map(refused);
		expect(
			mapper.map(fallback([refused.uuid])).filter((item) => item.event.type === "messages_retracted"),
		).toHaveLength(1);
		expect(mapper.map(fallback([refused.uuid])).filter((item) => item.event.type === "messages_retracted")).toEqual([]);
		expect(
			mapper
				.map(fallback(["00000000-0000-4000-8000-0000000000ff"]))
				.filter((item) => item.event.type === "messages_retracted"),
		).toEqual([]);
		const first = assistant("msg_C", [text("c1")]);
		mapper.map(first);
		const second = assistant("msg_C", [text("c2")], { supersedes: [first.uuid] });
		expect(mapper.map(second).filter((item) => item.event.type === "messages_retracted")).toEqual([]);
	});

	test("an open call or block of a retracted message is dropped with it: nothing of it ends later", () => {
		const mapper = newMapper();
		const call = assistant("msg_A", [toolUse("toolu_1", "Bash", { command: "ls" })]);
		mapper.map(call);
		mapper.map(fallback([call.uuid]));
		expect(mapper.map(toolResult("toolu_1", "late"))).toEqual([]);
		expect(mapper.settle("aborted")).toEqual([]);
	});

	test("another block of a message already withdrawn says nothing more", () => {
		const mapper = newMapper();
		const first = assistant("msg_A", [text("a1")]);
		const second = assistant("msg_A", [text("a2")]);
		mapper.map(first);
		mapper.map(second);
		const retracted = (uuids: string[]) =>
			mapper.map(fallback(uuids)).filter((item) => item.event.type === "messages_retracted");
		expect(retracted([first.uuid])).toHaveLength(1);
		expect(retracted([second.uuid])).toEqual([]);
	});

	test("several messages in one frame are one retraction", () => {
		const a = assistant("msg_A", [text("a")]);
		const b = assistant("msg_B", [text("b")]);
		const a2 = assistant("msg_A", [text("a2")]);
		const mapper = newMapper();
		for (const frame of [a, b, a2]) mapper.map(frame);
		const [event] = mapper.map(fallback([a.uuid, b.uuid, a2.uuid])).map((item) => item.event);
		expect(event).toEqual({ type: "messages_retracted", messageIds: ["msg_A", "msg_B"] });
	});
});

const AGENT = "agent-1";
const CHILD = "agent-2";

function under(parent: string, agent: string) {
	return { parent_tool_use_id: parent, agent_id: agent };
}

function start(taskId: string, toolUseId: string): SDKMessage {
	return {
		type: "system",
		subtype: "task_started",
		task_id: taskId,
		tool_use_id: toolUseId,
		description: "d",
		task_type: "local_agent",
		...ids(),
	};
}

describe("a subagent's work", () => {
	const spawn = assistant("msg_1", [toolUse("toolu_agent", "Agent", { description: "Look", prompt: "p" })]);

	test("while its call runs, it is whole in the child's stream and nested in the parent's", () => {
		const played = play([
			spawn,
			start(AGENT, "toolu_agent"),
			assistant("msg_s1", [toolUse("toolu_read", "Read", { file_path: "a" })], under("toolu_agent", AGENT)),
			toolResult("toolu_read", "text", { extra: under("toolu_agent", AGENT) }),
			assistant("msg_s2", [text("found")], under("toolu_agent", AGENT)),
			toolResult("toolu_agent", "done"),
		]);
		expect(shapeOf(played.streams.get(""))).toBe(
			"run_started tool_started tool_updated:child_session tool_started^ tool_finished:completed block_started:text^ block_finished tool_finished:completed run_finished:completed",
		);
		expect(shapeOf(played.streams.get(AGENT))).toBe(
			"run_started tool_started tool_finished:completed block_started:text block_finished run_finished:completed",
		);
		expect(violationsOf(played)).toEqual([]);
		const nested = ofType(played.streams.get(""), "tool_started").find((event) => event.toolCallId === "toolu_read");
		expect(nested?.parentToolCallId).toBe("toolu_agent");
		const own = ofType(played.streams.get(AGENT), "tool_started")[0];
		expect(own?.parentToolCallId).toBeUndefined();
	});

	test("after its call ended, only the child's stream hears of it, since a call that is over cannot be a parent", () => {
		const played = play([
			spawn,
			start(AGENT, "toolu_agent"),
			toolResult("toolu_agent", "launched"),
			assistant("msg_s1", [text("later")], under("toolu_agent", AGENT)),
		]);
		expect(shapeOf(played.streams.get(""))).toBe(
			"run_started tool_started tool_updated:child_session tool_finished:completed run_finished:completed",
		);
		expect(shapeOf(played.streams.get(AGENT))).toBe(
			"run_started block_started:text block_finished run_finished:completed",
		);
		expect(violationsOf(played)).toEqual([]);
	});

	test("a subagent inside a subagent shows in its own stream and under its call wherever that call is shown", () => {
		const played = play([
			spawn,
			start(AGENT, "toolu_agent"),
			assistant(
				"msg_s1",
				[toolUse("toolu_inner", "Agent", { description: "Deeper", prompt: "p" })],
				under("toolu_agent", AGENT),
			),
			start(CHILD, "toolu_inner"),
			assistant("msg_s2", [text("deep")], under("toolu_inner", CHILD)),
			toolResult("toolu_inner", "up", { extra: under("toolu_agent", AGENT) }),
			toolResult("toolu_agent", "done"),
		]);
		for (const stream of ["", AGENT, CHILD]) expect(played.streams.has(stream)).toBe(true);
		const deep = (stream: string) =>
			ofType(played.streams.get(stream), "block_started").map((event) => event.parentToolCallId);
		expect(deep("")).toEqual(["toolu_inner"]);
		expect(deep(AGENT)).toEqual(["toolu_inner"]);
		expect(deep(CHILD)).toEqual([undefined]);
		expect(violationsOf(played)).toEqual([]);
	});

	test("a frame with only its parent call is nested there; with an agent id the parent cannot be shown in, only the child", () => {
		const nestedOnly = play([spawn, assistant("msg_s1", [text("x")], { parent_tool_use_id: "toolu_agent" })]).streams;
		expect([...nestedOnly.keys()]).toEqual([""]);
		expect(ofType(nestedOnly.get(""), "block_started")[0]?.parentToolCallId).toBe("toolu_agent");
		const orphan = play([assistant("msg_s1", [text("x")], under("toolu_gone", AGENT))]).streams;
		expect([...orphan.keys()]).toEqual([AGENT]);
	});

	test("a frame with nowhere to go, or an agent id the CLI never makes, shows nothing", () => {
		expect(play([assistant("msg_s1", [text("x")], { parent_tool_use_id: "toolu_gone" })]).streams.size).toBe(0);
		expect(play([assistant("msg_s1", [text("x")], under("toolu_gone", "bad id!"))]).streams.size).toBe(0);
	});

	test("its prompt is a user message of the child only; a prompt that is not a person's is none", () => {
		const played = play([
			spawn,
			userText("Read the file", under("toolu_agent", AGENT)),
			userText("Synthetic", { ...under("toolu_agent", AGENT), isSynthetic: true }),
		]);
		expect(ofType(played.streams.get(AGENT), "user_message")).toHaveLength(1);
		expect(ofType(played.streams.get(""), "user_message")).toEqual([]);
	});

	test("a run ending with its work open ends it in every stream that shows it, once", () => {
		const mapper = newMapper();
		for (const frame of [
			spawn,
			start(AGENT, "toolu_agent"),
			assistant("msg_s1", [toolUse("toolu_read", "Read", {})], under("toolu_agent", AGENT)),
		]) {
			mapper.map(frame);
		}
		const ended = mapper.settle("aborted").filter((item) => item.event.type === "tool_finished");
		expect(
			ended.map((item) => [item.agentId ?? "", item.event.type === "tool_finished" && item.event.toolCallId]),
		).toEqual([
			["", "toolu_agent"],
			[AGENT, "toolu_read"],
			["", "toolu_read"],
		]);
	});

	test("a retraction reaches the streams the message was shown in", () => {
		const sub = assistant("msg_s1", [text("x")], under("toolu_agent", AGENT));
		const played = play([spawn, sub, fallback([sub.uuid])]);
		const retracted = (stream: string) => ofType(played.streams.get(stream), "messages_retracted");
		expect(retracted("")).toEqual([{ type: "messages_retracted", messageIds: ["msg_s1"] }]);
		expect(retracted(AGENT)).toEqual([{ type: "messages_retracted", messageIds: ["msg_s1"] }]);
	});
});
