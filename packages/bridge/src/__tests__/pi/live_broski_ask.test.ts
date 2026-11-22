/**
 * On the real adapter and the real `pi`: the bridge's own extension gives the model `broski_ask`, so a Pi with no
 * questions extension of the user's asks on the phone. The run waits on one questions card, never behind a permission
 * ask, and the model reads the person's answer, or that they dismissed it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Interaction, InteractionReply } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import type { ScriptedRequest } from "../helpers/scripted-openai-server";
import { LiveRig } from "./helpers/live-rig";
import { textOf } from "./helpers/pi-router";
import { call, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const ASKED = {
	title: "Storage",
	questions: [
		{ question: "Which store?", header: "Store", options: [{ label: "SQLite" }, { label: "Redis" }] },
		{ question: "Anything else?" },
	],
};

/** A session whose run calls `broski_ask`, then ends with the tool result the model was sent. */
async function asking(rig: LiveRig, modes: { axis: string; value: string }[] = []) {
	const live = await rig.rig.openNew({ modes });
	const seen = Promise.withResolvers<string>();
	const afterAnswer = (request: ScriptedRequest) => {
		const results = request.messages.filter((message) => message.role === "tool");
		seen.resolve(textOf(results.at(-1)?.content));
		return say("Thanks.");
	};
	rig.router.script(live.ref.sessionId, [call("broski_ask", ASKED), afterAnswer]);
	await live.prompt("Ask me where to store things.");
	const { interaction } = await live.waitFor("interaction_requested");
	return { live, interaction, toolResult: seen.promise };
}

function answer(live: LiveSession, interaction: Interaction, reply: InteractionReply) {
	return live.control.answer({ interactionId: interaction.id, reply });
}

describe("broski_ask in a hosted pi", () => {
	test("is one questions card the run waits on, and the model reads the answers", async () => {
		t = await LiveRig.create();
		const { live, interaction, toolResult } = await asking(t);
		expect(interaction).toMatchObject({
			title: "Storage",
			blocksRun: true,
			runId: live.reduced().run?.runId,
			request: {
				kind: "questions",
				questions: [
					{ id: "0", header: "Store", text: "Which store?", options: [{ label: "SQLite" }, { label: "Redis" }] },
					{ id: "1", text: "Anything else?", options: [], allowCustom: true },
				],
			},
		});
		expect(live.reduced().run).toBeDefined();

		const reply: InteractionReply = {
			kind: "questions",
			answers: [
				{ questionId: "0", selected: ["Redis"] },
				{ questionId: "1", selected: [], custom: "Keep it local." },
			],
		};
		expect((await answer(live, interaction, reply)).status).toBe("accepted");
		expect(JSON.parse(await toolResult)).toEqual({
			status: "answered",
			answers: [
				{ question: "Which store?", selected: ["Redis"] },
				{ question: "Anything else?", selected: [], custom: "Keep it local." },
			],
		});
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		live.assertSettled();
	});

	test("in ask mode it raises no permission ask of its own", async () => {
		t = await LiveRig.create();
		const { live, interaction, toolResult } = await asking(t, [{ axis: "permissions", value: "ask" }]);
		expect(interaction.request.kind).toBe("questions");
		await answer(live, interaction, { kind: "questions", answers: [{ questionId: "0", selected: ["SQLite"] }] });
		expect(JSON.parse(await toolResult).status).toBe("answered");
		await live.waitFor("run_finished");
		const asks = live.events().filter((event) => event.type === "interaction_requested");
		expect(asks).toHaveLength(1);
	});

	test("a dismissed card tells the model it was cancelled, and the run goes on", async () => {
		t = await LiveRig.create();
		const { live, interaction, toolResult } = await asking(t);
		await answer(live, interaction, { kind: "cancel", stopRun: false });
		expect(JSON.parse(await toolResult)).toEqual({
			status: "cancelled",
			message: "The user dismissed the questions.",
		});
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
	});
});
