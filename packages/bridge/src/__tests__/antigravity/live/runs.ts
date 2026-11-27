/** What a live test reads of a run through the backend's public surface: its events, its answer, its asks. */

import { expect } from "bun:test";
import type {
	AgentEvent,
	Interaction,
	InteractionReply,
	PromptInput,
	RunOutcome,
	SessionSnapshot,
} from "../../../contract";
import { type LiveSession, promptInput } from "../../../contract/testing/conformance-harness";

export const OK_PROMPT = "Reply with exactly: ok";

/**
 * A turn held on agy's question until something ends it. A permission would hold only where agy's permission policy
 * asks before the command, while agy raises its questions on any policy.
 */
export const HOLD_PROMPT =
	'Use your ask_question tool to ask me one question, "Shall I go on?", with the options Yes and No. Then reply with exactly: done';

/**
 * A turn the model has to reason through itself, told to: a product too long to answer from memory, so a model at its
 * highest thinking level thinks before it answers.
 */
export const THINK_PROMPT =
	"Without using any tools, think it through step by step, working out each partial product, then reply with only the number: what is 4567 times 89?";
export const THINK_ANSWER = "406463";

export interface FinishedRun {
	readonly runId: string;
	readonly outcome: RunOutcome;
	/** The run's events, from its `run_started` to its `run_finished`. */
	readonly events: AgentEvent[];
	/** Every ask raised in the run, in order. */
	readonly asks: Interaction[];
}

export function input(text: string, extra: Partial<PromptInput> = {}): PromptInput {
	return { ...promptInput(text, "start", crypto.randomUUID()), ...extra };
}

/** Sends `prompt`, answers each ask with `decide` as it comes, and returns once the run has finished. */
export async function runAnswering(
	live: LiveSession,
	prompt: PromptInput,
	decide: (interaction: Interaction) => InteractionReply = noAsks,
): Promise<FinishedRun> {
	const mark = live.recorder.items.length;
	const sent = await live.control.prompt(prompt);
	expect(sent).toEqual({ status: "accepted", disposition: "started" });
	const { runId } = await live.waitFor("run_started", () => true, mark);
	const asks: Interaction[] = [];
	let cursor = mark;
	for (;;) {
		const next = await nextOf(live, cursor, runId);
		cursor = next.index + 1;
		if (next.event.type === "run_finished") {
			return { runId, outcome: next.event.outcome, events: eventsOf(live, mark, cursor), asks };
		}
		asks.push(next.event.interaction);
		const answered = await live.control.answer({
			interactionId: next.event.interaction.id,
			reply: decide(next.event.interaction),
		});
		expect(answered).toEqual({ status: "accepted" });
	}
}

/** Runs `text` with no ask expected. */
export function run(live: LiveSession, text: string): Promise<FinishedRun> {
	return runAnswering(live, input(text));
}

function noAsks(interaction: Interaction): InteractionReply {
	throw new Error(`agy asked "${interaction.title}" (${interaction.request.kind}) where no ask was expected`);
}

async function nextOf(live: LiveSession, from: number, runId: string) {
	return live.recorder.waitFor((records) => {
		for (let index = from; index < records.length; index += 1) {
			const event = records[index]?.event;
			if (event === undefined) continue;
			if (event.type === "interaction_requested" || (event.type === "run_finished" && event.runId === runId)) {
				return { index, event };
			}
		}
		return undefined;
	}, `an ask or the end of run ${runId}`);
}

function eventsOf(live: LiveSession, from: number, to: number): AgentEvent[] {
	return live.recorder.items.slice(from, to).map((record) => record.event);
}

/** The text the run's answer blocks finished with. */
export function answerText(events: readonly AgentEvent[]): string {
	return blockTexts(events, "text").join("\n");
}

export function blockTexts(events: readonly AgentEvent[], kind: "text" | "thinking"): string[] {
	const blocks = new Set(
		events.flatMap((event) => (event.type === "block_started" && event.kind === kind ? [event.blockId] : [])),
	);
	return events.flatMap((event) => (event.type === "block_finished" && blocks.has(event.blockId) ? [event.text] : []));
}

/** The reply that picks the permission option with `effect`. */
export function permissionReply(interaction: Interaction, effect: "allow" | "deny"): InteractionReply {
	if (interaction.request.kind !== "tool_permission") {
		throw new Error(`expected a permission, got ${interaction.request.kind}`);
	}
	const option = interaction.request.options.find((candidate) => candidate.effect === effect);
	if (option === undefined) throw new Error(`"${interaction.title}" offers no ${effect} option`);
	return { kind: "tool_permission", optionId: option.id, grantIds: [] };
}

/** The command a permission would run, as its preview shows it. */
export function commandOf(interaction: Interaction): string | undefined {
	if (interaction.request.kind !== "tool_permission") return undefined;
	const preview = interaction.request.previews.find((candidate) => candidate.kind === "command");
	return preview?.kind === "command" ? preview.command : undefined;
}

export function contextOf(snapshot: SessionSnapshot): string {
	const usage = snapshot.usage;
	return `context ${usage?.contextTokens ?? "?"} of ${usage?.contextWindow ?? "?"}`;
}
