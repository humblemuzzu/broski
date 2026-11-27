/**
 * What the recorder has the real backend do, one scenario per fixture, in order: the later ones read the session the
 * first one made. Each runs on a backend of its own, so a fixture holds exactly the `agy` processes its scenario
 * started. A scenario about agy's permission ask is recorded under its name with `-unasked` when agy's permission
 * policy approved what it asks for, so agy asked nothing. Twelve prompts in all, each through the account's guard
 * (`live/guard.ts`).
 */

import { expect } from "bun:test";
import type { SessionRef } from "../../../contract";
import { allTranscript } from "../../../contract/testing/conformance-reads";
import { pngAttachment } from "../live/png";
import { HOLD_PROMPT, input, OK_PROMPT, permissionReply, run, runAnswering } from "../live/runs";
import type { LiveBackend } from "../live/world";

export interface Recording {
	readonly backend: LiveBackend;
	/** The session `plain-turn` made, which the reading scenarios read. */
	plain?: SessionRef;
	/** What the frames show when agy did otherwise than the scenario is named for, which they are recorded under. */
	played?: Pick<Scenario, "name" | "about">;
}

export interface Scenario {
	readonly name: string;
	/** What the frames show, for whoever replays them. */
	readonly about: string;
	readonly run: (recording: Recording) => Promise<void>;
}

const QUESTION = (options: string) =>
	`Use your ask_question tool to ask me one question, "Which ones?", ${options}. Then reply with what I chose, or with exactly: none if I chose nothing.`;

function plainOf(recording: Recording): SessionRef {
	return recording.plain ?? expect.unreachable("plain-turn made no session");
}

export const SCENARIOS: readonly Scenario[] = [
	{
		name: "plain-turn",
		about:
			"A new session on the per-session front (the catalog probe's short job first), one prompt answered with text.",
		run: async (recording) => {
			const live = await recording.backend.openNew();
			expect((await run(live, OK_PROMPT)).outcome).toEqual({ kind: "completed" });
			recording.plain = live.ref;
		},
	},
	{
		name: "thinking",
		about: "A turn at the cheap model's highest thinking level, which streams agent_thought_chunk before its answer.",
		run: async ({ backend }) => {
			const live = await backend.openNew();
			backend.guarded.thinkDeeply(live.ref.sessionId);
			const turn = await run(
				live,
				"Think it through step by step, then reply with only the number: what is 17 times 23?",
			);
			expect(turn.outcome).toEqual({ kind: "completed" });
		},
	},
	permissionTurn(
		"permission-allow",
		"run_command asks session/request_permission; the allow option is selected and the command runs.",
		"Run the shell command `touch allowed.txt` in the current folder, then reply with exactly: done",
		"allow",
	),
	permissionTurn(
		"permission-deny",
		"run_command asks session/request_permission; the reject option is selected and agy goes on without it.",
		"Run the shell command `touch denied.txt` in the current folder, then reply with exactly: done",
		"deny",
	),
	{
		name: "cancel-with-pending-ask",
		about:
			"session/cancel while agy's question is pending: the elicitation is answered cancel, the prompt ends cancelled.",
		run: async ({ backend }) => {
			const live = await backend.openNew();
			expect(await live.control.prompt(input(HOLD_PROMPT))).toMatchObject({ status: "accepted" });
			await live.waitFor("interaction_requested");
			expect(await live.control.abort()).toEqual({ status: "accepted" });
			expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "aborted" });
		},
	},
	{
		name: "question-single",
		about: "ask_question as elicitation/create with a qN string of oneOf choices, accepted with one const.",
		run: ({ backend }) =>
			answered(backend, QUESTION("with exactly one choice of Red or Blue"), (labels) => labels.slice(-1)),
	},
	{
		name: "question-multi",
		about: "ask_question as elicitation/create with a qN array of anyOf choices, accepted with two consts.",
		run: ({ backend }) =>
			answered(backend, QUESTION("letting me choose any number of Apple, Pear and Plum"), (labels) =>
				labels.slice(0, 2),
			),
	},
	{
		name: "question-decline",
		about: "ask_question declined: the elicitation is answered decline and the turn goes on.",
		run: async ({ backend }) => {
			const live = await backend.openNew();
			const turn = await runAnswering(live, input(QUESTION("with the options Yes and No")), () => ({
				kind: "cancel",
				stopRun: false,
			}));
			expect(turn.outcome).toEqual({ kind: "completed" });
		},
	},
	{
		name: "listing",
		about: "session/list on a short job: every conversation at once (the user's own reduced to numbered shapes).",
		run: async ({ backend }) => {
			expect((await backend.backend.listSessions({}, { limit: 200 })).status).toBe("accepted");
		},
	},
	{
		name: "load-replay",
		about: "A short job's session/load of plain-turn's session: the replay before the answer, then session/close.",
		run: async (recording) => {
			const items = await allTranscript(recording.backend.backend, plainOf(recording), 200);
			expect(items.some((item) => item.kind === "user_message")).toBe(true);
		},
	},
	{
		name: "mid-turn-second-prompt",
		about:
			"A second prompt while a turn streams, refused busy by the backend: agy is sent the first session/prompt only.",
		run: async ({ backend }) => {
			const live = await backend.openNew();
			const turn = run(live, "Write every whole number from 1 to 60, one per line, and nothing else.");
			await live.waitFor("block_delta");
			expect(await live.control.prompt(input(OK_PROMPT))).toMatchObject({
				status: "rejected",
				rejection: { code: "busy" },
			});
			expect((await turn).outcome).toEqual({ kind: "completed" });
		},
	},
	permissionTurn(
		"tool-edit-diff",
		"write_file then edit_file, each asking with its diff content (no oldText for the new file), both allowed.",
		"Create the file notes.txt containing exactly: one\nThen edit notes.txt, replacing one with two. Then reply with exactly: done",
		"allow",
	),
	{
		name: "compact",
		about: "plain-turn's session loaded on the front, then /compact sent as a prompt.",
		run: async (recording) => {
			const live = await recording.backend.open(plainOf(recording));
			expect(await live.control.compact?.(undefined)).toEqual({ status: "accepted" });
			expect((await live.waitFor("compaction_finished")).outcome.kind).toBe("completed");
		},
	},
	{
		name: "image-turn",
		about: "A prompt with an image content block (a 32×32 PNG of one colour) and the model's answer about it.",
		run: async ({ backend }) => {
			const live = await backend.openNew();
			const image = pngAttachment([220, 30, 30], "red.png");
			const turn = await runAnswering(
				live,
				input("What colour is this image? Reply with one word.", { attachments: [image] }),
			);
			expect(turn.outcome).toEqual({ kind: "completed" });
		},
	},
];

/** A turn whose tools agy asks permission for, each answered `effect`; one agy asks nothing in is recorded as unasked. */
function permissionTurn(name: string, about: string, prompt: string, effect: "allow" | "deny"): Scenario {
	return {
		name,
		about,
		run: async (recording) => {
			const live = await recording.backend.openNew();
			const turn = await runAnswering(live, input(prompt), (ask) => permissionReply(ask, effect));
			expect(turn.outcome).toEqual({ kind: "completed" });
			if (turn.asks.length > 0) return;
			recording.played = {
				name: `${name}-unasked`,
				about:
					"The same prompt on an agy whose own permission policy approves it: the tools run, and agy sends no session/request_permission.",
			};
			console.log(`${name}: agy asked nothing, as its own permission policy approved it; recorded as ${name}-unasked`);
		},
	};
}

/** A question turn answered with the labels `pick` chooses of the options agy offered. */
async function answered(backend: LiveBackend, prompt: string, pick: (labels: string[]) => string[]): Promise<void> {
	const live = await backend.openNew();
	const turn = await runAnswering(live, input(prompt), (ask) => {
		if (ask.request.kind !== "questions") throw new Error(`expected questions, got ${ask.request.kind}`);
		const answers = ask.request.questions.map((question) => ({
			questionId: question.id,
			selected: pick(question.options.map((option) => option.label)),
		}));
		return { kind: "questions", answers };
	});
	expect(turn.outcome).toEqual({ kind: "completed" });
}
