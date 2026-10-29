import { describe, test } from "bun:test";
import type { SinkRecord } from "../contract/backend";
import { aRunStreamsAndEnds, aToolCallStartsAndFinishes, declaredFeaturesAppear } from "../contract/testing/rules-runs";
import { breakBackend, breakDriver, breakSessions, breakStream, fails, record } from "./helpers/broken-adapters";

/** Drops every event of the blocks `kind` opens. */
function withoutBlocks(kind: "text" | "thinking" | "plan") {
	const dropped = new Set<string>();
	return breakStream((item) => {
		const event = item.event;
		if (event.type === "block_started" && event.kind === kind) dropped.add(event.blockId);
		const block = event.type === "block_started" || event.type === "block_delta" || event.type === "block_finished";
		return block && dropped.has(event.blockId) ? [] : [item];
	});
}

describe("the run rule fails", () => {
	test("for a prompt that never starts a run", () =>
		fails(
			breakSessions((session) =>
				session.control
					? {
							...session,
							control: { ...session.control, prompt: async () => ({ status: "accepted", disposition: "handled" }) },
						}
					: session,
			),
			aRunStreamsAndEnds,
			/the prompt was not started/,
		));

	test("for a run that never finishes", () =>
		fails(
			breakStream((item) => (item.event.type === "run_finished" ? [] : [item])),
			aRunStreamsAndEnds,
			/timed out .* run_finished/,
		));

	test("for a run that does not complete", () =>
		fails(
			breakStream((item) =>
				item.event.type === "run_finished"
					? [{ ...item, event: { ...item.event, outcome: { kind: "error", error: { code: "server", message: "x" } } } }]
					: [item],
			),
			aRunStreamsAndEnds,
			/the run ended error/,
		));

	test("for a finished block whose text differs from its deltas", () =>
		fails(
			breakStream((item) =>
				item.event.type === "block_finished" ? [{ ...item, event: { ...item.event, text: "other" } }] : [item],
			),
			aRunStreamsAndEnds,
			/differs from the deltas/,
		));

	test("for one prompt that starts two runs", () =>
		fails(
			breakStream((item) =>
				item.event.type === "run_finished"
					? [
							item,
							record({ type: "run_started", runId: "extra", trigger: "prompt" }),
							record({ type: "run_finished", runId: "extra", outcome: { kind: "completed" } }),
						]
					: [item],
			),
			aRunStreamsAndEnds,
			/started more than one run/,
		));

	test("for a user message without the prompt's clientRequestId", () =>
		fails(
			breakStream((item) =>
				item.event.type === "user_message"
					? [{ ...item, event: { type: "user_message", messageId: item.event.messageId, text: "", attachments: [] } }]
					: [item],
			),
			aRunStreamsAndEnds,
			/does not carry its clientRequestId/,
		));

	test("for a run without text", () => fails(withoutBlocks("text"), aRunStreamsAndEnds, /produced no text/));

	test("for text deltas withheld while streamText is declared", () =>
		fails(
			breakStream((item) => (item.event.type === "block_delta" ? [] : [item])),
			aRunStreamsAndEnds,
			/streamText is declared but no text delta was sent/,
		));

	test("for thinking deltas from a backend that says it does not stream them", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, streamThinking: false } })),
			aRunStreamsAndEnds,
			/thinking deltas from a backend that does not stream them/,
		));
});

describe("the tool rule fails", () => {
	test("for a tool that never finishes", () =>
		fails(
			breakStream((item) => (item.event.type === "tool_finished" ? [] : [item])),
			aToolCallStartsAndFinishes,
			/tools still running/,
		));

	test("for a run whose tool is never reported", () =>
		fails(
			breakStream((item) =>
				item.event.type === "tool_started" || item.event.type === "tool_updated" || item.event.type === "tool_finished"
					? []
					: [item],
			),
			aToolCallStartsAndFinishes,
			/no tool started/,
		));
});

describe("the feature rule fails", () => {
	const drop = (type: SinkRecord["event"]["type"]) => breakStream((item) => (item.event.type === type ? [] : [item]));

	test("for thinking that never streams", () =>
		fails(
			breakStream((item) => (item.event.type === "block_delta" ? [] : [item])),
			declaredFeaturesAppear,
			/thinking is declared but the run did not show it/,
		));

	test("for usage that never shows", () =>
		fails(drop("usage_updated"), declaredFeaturesAppear, /usage is declared but the run did not show it/));

	test("for a plan that never shows", () =>
		fails(drop("plan_updated"), declaredFeaturesAppear, /plan is declared but the run did not show it/));

	test("for a proposed plan that never shows", () =>
		fails(withoutBlocks("plan"), declaredFeaturesAppear, /plan_proposal is declared but the run did not show it/));

	test("for a child session that never shows", () =>
		fails(
			breakStream((item) =>
				item.event.type === "tool_updated" && item.event.update.kind === "child_session" ? [] : [item],
			),
			declaredFeaturesAppear,
			/children is declared but the run did not show it/,
		));

	test("for a declared feature the driver cannot produce", () =>
		fails(
			breakDriver((driver) => ({
				arrange: async (session, scenario) => scenario.kind !== "feature" && driver.arrange(session, scenario),
			})),
			declaredFeaturesAppear,
			/cannot arrange/,
		));
});

describe("sessions that cannot be controlled", () => {
	test("fail every rule that drives a run", () =>
		fails(
			breakSessions(({ control: _control, ...session }) => session),
			aRunStreamsAndEnds,
			/cannot be controlled/,
		));
});
