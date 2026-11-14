/**
 * What each recorded scenario shows, as the sequence of events its frames map to (the shapes were read against the
 * frames by hand, see the notes beside each). `block_delta*3` is three deltas; `^` marks a block or call nested
 * under the tool call that runs its subagent.
 */

import { describe, expect, test } from "bun:test";
import { readFrameFixture } from "../helpers/frame-fixtures";
import { ofType, playFixture, shapeOf } from "./helpers";

const TURN = "block_started:text block_delta block_finished usage_updated";
const RUN = (middle: string, end = "completed") => `run_started ${middle} run_finished:${end}`;
const TOOL_THEN_ANSWER = (outcome: string) => RUN(`tool_started tool_finished:${outcome} ${TURN}`);

const MAIN_STREAMS: readonly [scenario: string, shape: string, note: string][] = [
	[
		"text",
		RUN("block_started:text block_delta*3 block_finished usage_updated"),
		"three deltas, the assistant frame finishes the block",
	],
	[
		"thinking",
		RUN(
			"block_started:thinking block_delta*2 block_finished block_started:text block_delta block_finished usage_updated",
		),
		"thinking is block 0, text block 1 of one message",
	],
	["tool-read", TOOL_THEN_ANSWER("completed"), "a Read call and its result, then the answer"],
	["steer-next", TOOL_THEN_ANSWER("completed"), "the steer is the host's; the frames are one turn"],
	["permission-allow", TOOL_THEN_ANSWER("completed"), "the ask is the desk's: only the Write call shows"],
	[
		"permission-deny",
		TOOL_THEN_ANSWER("denied"),
		"the live frame's tool_result_meta says reject, whatever words the person's deny message used",
	],
	["ask-user-question", TOOL_THEN_ANSWER("completed"), "AskUserQuestion is a tool call like any other"],
	["elicitation-form", TOOL_THEN_ANSWER("completed"), "the elicitation is the desk's"],
	["elicitation-url", TOOL_THEN_ANSWER("completed"), "the elicitation is the desk's"],
	[
		"interrupt-mid-text",
		RUN("block_started:text block_delta block_finished", "aborted"),
		"the aborted frame finishes its block; no model usage, so no usage_updated",
	],
	["interrupt-mid-tool", RUN("tool_started tool_finished:aborted usage_updated", "aborted"), "the tool ends aborted"],
	["retry-529", RUN(`retry_scheduled retry_finished ${TURN}`), "the retry finishes at the next frame of the turn"],
	[
		"refusal",
		RUN(
			"block_started:text block_delta block_finished notice:info block_started:text block_delta block_finished notice:error usage_updated",
			"error",
		),
		"the CLI's notice, the retried text, then the synthetic error frame as a notice; the outcome is an error",
	],
	[
		"queue-later",
		RUN(`block_started:text block_delta*10 block_finished usage_updated ${TURN}`),
		"two turns in one run, a usage_updated after each result",
	],
	[
		"compaction",
		`${RUN(TURN.replace("usage_updated", "usage_updated"))} run_started compaction_started compaction_finished:completed usage_updated run_finished:completed`,
		"the manual compaction is its own run: started at status, finished at the boundary",
	],
];

describe("what each scenario shows", () => {
	for (const [scenario, shape, note] of MAIN_STREAMS) {
		test(`${scenario}: ${note}`, () => {
			expect(shapeOf(playFixture(scenario).streams.get(""))).toBe(shape);
		});
	}

	for (const scenario of ["exit-plan-approve", "exit-plan-edited", "exit-plan-set-mode"]) {
		test(`${scenario}: the plan file write, ExitPlanMode and the answer`, () => {
			expect(shapeOf(playFixture(scenario).streams.get(""))).toBe(
				RUN(`tool_started tool_finished:completed tool_started tool_finished:completed ${TURN}`),
			);
		});
	}

	test("exit-plan-deny: the rejected ExitPlanMode is denied (tool_result_meta), with the person's feedback", () => {
		const events = playFixture("exit-plan-deny").streams.get("");
		const ended = ofType(events, "tool_finished");
		expect(ended.map((event) => event.outcome)).toEqual(["completed", "denied"]);
		expect(ended[1]?.result.error).toBe("Add a test step first.");
	});
});

/** The agent id the Agent call's `child_session` update names, which is the key of the child's own stream. */
function agentOf(played: ReturnType<typeof playFixture>): string {
	const update = ofType(played.streams.get(""), "tool_updated").find((event) => event.update.kind === "child_session");
	if (update?.update.kind !== "child_session") throw new Error("no child session");
	const [parent, agent] = update.update.session.sessionId.split("/");
	expect(parent).toBe("11111111-2222-4333-8444-555555555555");
	return agent ?? "";
}

describe("subagents", () => {
	test("foreground: nested in the parent's run while its call runs, and whole in the child's own stream", () => {
		const played = playFixture("subagent");
		expect(shapeOf(played.streams.get(""))).toBe(
			RUN(
				"tool_started tool_updated:child_session tool_updated:progress tool_started^ tool_finished:completed block_started:text^ block_finished tool_finished:completed " +
					TURN,
			),
		);
		expect(shapeOf(played.streams.get(agentOf(played)))).toBe(
			RUN("user_message tool_started tool_finished:completed block_started:text block_finished"),
		);
	});

	test("background: the parent's call is over before the agent works, so its work goes to the child only", () => {
		const played = playFixture("subagent-background");
		expect(shapeOf(played.streams.get(""))).toBe(
			RUN(`tool_started tool_updated:child_session tool_finished:completed ${TURN} ${TURN}`),
		);
		expect(shapeOf(played.streams.get(agentOf(played)))).toBe(RUN("block_started:text block_finished"));
	});

	test("the child session of the call is <session>/<agent id>, the agent id of its frames", () => {
		const played = playFixture("subagent");
		const agent = agentOf(played);
		const frames = readFrameFixture("subagent");
		expect(frames.some((frame) => "agent_id" in frame && frame.agent_id === agent)).toBe(true);
	});
});

describe("run outcomes of the recorded results", () => {
	const finished = (scenario: string) =>
		ofType(playFixture(scenario).streams.get(""), "run_finished").map((event) => event.outcome);

	test("a clean turn completes", () => expect(finished("text")).toEqual([{ kind: "completed" }]));
	test("an interrupt aborts, whatever its subtype says (D31)", () => {
		expect(finished("interrupt-mid-text")).toEqual([{ kind: "aborted" }]);
		expect(finished("interrupt-mid-tool")).toEqual([{ kind: "aborted" }]);
	});
	test("a refusal is an error, never completed (D31)", () => {
		const [outcome] = finished("refusal");
		expect(outcome?.kind).toBe("error");
		expect(outcome?.kind === "error" && outcome.error.code).toBe("content_filter");
	});
});
