/**
 * agy's questions (its `ask_question` tool, a form elicitation) on the phone's side: a single pick, a multi-select
 * and the person's own words in one form; a question declined, after which the turn goes on; and a question pending
 * while the transcript is read (it stops before the running prompt), then cancelled with the run. Three prompts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Interaction, InteractionReply, Question, QuestionAnswer } from "../../../contract";
import type { LiveSession } from "../../../contract/testing/conformance-harness";
import { allTranscript } from "../../../contract/testing/conformance-reads";
import { TEST_MS } from "./gate";
import { answerText, input, runAnswering } from "./runs";
import { resultOf } from "./wire-log";
import { AgyWorld, type LiveBackend } from "./world";

const FORM_PROMPT = [
	"Use your ask_question tool once, asking me these three questions together:",
	'1. "Which colour?", one choice of Red or Blue.',
	'2. "Which fruits?", any number of Apple, Pear and Plum.',
	'3. "Which name?", one choice of Sam or Alex.',
	"After I answer, reply with my answers, one per line.",
].join("\n");
const DECLINE_PROMPT =
	'Use your ask_question tool to ask me one question, "Ready to go on?", with the options Yes and No. Then, whatever I answer or if I give no answer, reply with exactly: done';
const CANCEL_PROMPT =
	'Use your ask_question tool to ask me one question, "Which colour?", with the options Red and Blue. Then reply with the colour I chose.';
const OWN_NAME = "Robin";

export function questionsSuite(): void {
	describe("agy's questions", () => {
		let world: AgyWorld;
		let backend: LiveBackend;
		let live: LiveSession;

		beforeAll(async () => {
			world = AgyWorld.create({ label: "questions" });
			backend = await world.start();
			live = await backend.openNew();
		});
		afterAll(async () => {
			await world?.dispose();
			expect(world?.faults ?? []).toEqual([]);
		});

		test(
			"one form takes a single pick, several picks and the person's own words",
			async () => {
				const turn = await runAnswering(live, input(FORM_PROMPT), formAnswer);
				expect(turn.outcome).toEqual({ kind: "completed" });
				const questions = turn.asks.flatMap((ask) => (ask.request.kind === "questions" ? ask.request.questions : []));
				console.log(
					`questions: ${questions.map((q) => `${q.id} "${q.text}" multi=${q.multiSelect} custom=${q.allowCustom} [${q.options.map((o) => o.label).join("|")}]`).join("; ")}`,
				);
				expect(questionOf(questions, /colou?r/i)).toMatchObject({ multiSelect: false });
				expect(questionOf(questions, /fruit/i)).toMatchObject({ multiSelect: true });
				expect(questionOf(questions, /name/i)).toMatchObject({ allowCustom: true });
				const answered = elicitations(world, live).map((exchange) => resultOf(exchange.answer));
				console.log(`agy was answered: ${JSON.stringify(answered)}`);
				const content = answered.flatMap((result) => (result?.action === "accept" ? [result.content] : []));
				expect(content.some((fields) => Object.values(fields ?? {}).some(Array.isArray))).toBe(true);
				expect(
					content.some((fields) =>
						Object.entries(fields ?? {}).some(([key, value]) => key.endsWith("_other") && value === OWN_NAME),
					),
				).toBe(true);
				const text = answerText(turn.events).toLowerCase();
				for (const word of ["blue", "apple", "plum", OWN_NAME.toLowerCase()]) expect(text).toContain(word);
				live.assertSettled();
			},
			TEST_MS,
		);

		test(
			"a declined question lets the turn go on",
			async () => {
				const turn = await runAnswering(live, input(DECLINE_PROMPT), () => ({ kind: "cancel", stopRun: false }));
				expect(turn.outcome).toEqual({ kind: "completed" });
				expect(turn.asks.map((ask) => ask.request.kind)).toEqual(["questions"]);
				expect(resultOf(elicitations(world, live).at(-1)?.answer)).toEqual({ action: "decline" });
				expect(answerText(turn.events).toLowerCase()).toContain("done");
				live.assertSettled();
			},
			TEST_MS,
		);

		test(
			"while a question waits the transcript stops before the running prompt; cancelling it stops the run",
			async () => {
				const mark = live.recorder.items.length;
				expect(await live.control.prompt(input(CANCEL_PROMPT))).toMatchObject({ status: "accepted" });
				const { runId } = await live.waitFor("run_started", () => true, mark);
				const asked = await live.waitFor("interaction_requested", () => true, mark);
				const during = await allTranscript(backend.backend, live.ref, 200);
				expect(during.some((item) => item.kind === "user_message" && item.text === CANCEL_PROMPT)).toBe(false);

				const reply: InteractionReply = { kind: "cancel", stopRun: true };
				expect(await live.control.answer({ interactionId: asked.interaction.id, reply })).toEqual({
					status: "accepted",
				});
				const finished = await live.waitFor("run_finished", (event) => event.runId === runId, mark);
				expect(finished.outcome).toEqual({ kind: "aborted" });
				expect(resultOf(elicitations(world, live).at(-1)?.answer)).toEqual({ action: "cancel" });
				expect(world.tap.notifications("session/cancel", live.ref.sessionId).length).toBeGreaterThan(0);
				live.assertSettled();

				const after = await allTranscript(backend.backend, live.ref, 200);
				expect(after.some((item) => item.kind === "user_message" && item.text === CANCEL_PROMPT)).toBe(true);
			},
			TEST_MS,
		);
	});
}

function elicitations(world: AgyWorld, live: LiveSession) {
	return world.tap.exchanges("elicitation/create", live.ref.sessionId, "agent");
}

function questionOf(questions: readonly Question[], text: RegExp): Question | undefined {
	return questions.find((question) => text.test(question.text));
}

/** Blue; Apple and Plum; and the person's own name where agy offers to take one. */
function formAnswer(interaction: Interaction): InteractionReply {
	if (interaction.request.kind !== "questions") throw new Error(`expected questions, got ${interaction.request.kind}`);
	return { kind: "questions", answers: interaction.request.questions.map(answerOf) };
}

function answerOf(question: Question): QuestionAnswer {
	const labels = (pattern: RegExp) =>
		question.options.filter((option) => pattern.test(option.label)).map((option) => option.label);
	if (/name/i.test(question.text) && question.allowCustom) {
		return { questionId: question.id, selected: [], custom: OWN_NAME };
	}
	if (/fruit/i.test(question.text)) return { questionId: question.id, selected: labels(/apple|plum/i) };
	if (/colou?r/i.test(question.text)) return { questionId: question.id, selected: labels(/blue/i) };
	return { questionId: question.id, selected: question.options.slice(0, 1).map((option) => option.label) };
}
