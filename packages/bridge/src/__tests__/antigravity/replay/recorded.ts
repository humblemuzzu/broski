/**
 * What a recording shows agy and the bridge wrote, read straight from its records and not through the bridge's readers:
 * what the replay tests hold the phone's view to wherever the model chose it (an answer's words, a title, a tool's
 * arguments, a label, a token count), so the tests keep to what each scenario is about and pass on any recording of it.
 * A record that is not of the shape asked for throws, naming it.
 */

import { z } from "zod";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { JsonValue } from "../../../contract";
import type { Frame } from "../live/wire-log";
import type { RecordedAgy } from "../record/scrub";

type Fields = Readonly<Record<string, unknown>>;

const Fill = z.object({ used: z.number(), size: z.number() });
const Arguments = z.record(z.string(), JsonValue);
const Choices = z.array(z.object({ title: z.string() }));
const Question = z.union([
	z.object({ type: z.literal("string"), title: z.string(), oneOf: Choices }),
	z.object({ type: z.literal("array"), title: z.string(), items: z.object({ anyOf: Choices }) }),
]);

function fields(value: unknown): Fields {
	return isRecord(value) ? value : {};
}

function read<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new Error(`the recording's ${what} is not as expected: ${JSON.stringify(value)}`);
	return parsed.data;
}

/** The params of each request or notification of `method` that `from` sent, in order. */
export function recordsOf(agy: RecordedAgy, method: string, from: Frame["from"] = "agent"): Fields[] {
	return agy.frames
		.filter((frame) => frame.from === from && frame.message.method === method)
		.map((frame) => fields(frame.message.params));
}

/** agy's answer to the first request of `method` the bridge sent. */
export function answerTo(agy: RecordedAgy, method: string): Fields {
	const request = agy.frames.find((frame) => frame.from === "client" && frame.message.method === method);
	if (request === undefined) throw new Error(`the recording shows no ${method}`);
	const answer = agy.frames.find(
		(frame) => frame.from === "agent" && frame.message.method === undefined && frame.message.id === request.message.id,
	);
	return fields(answer?.message.result);
}

/**
 * agy's `session/update`s of `kind`, in the order agy sent them; with `before`, only those ahead of the first record of
 * that method the bridge sent.
 */
export function updatesOf(agy: RecordedAgy, kind: string, before?: string): Fields[] {
	const end =
		before === undefined
			? -1
			: agy.frames.findIndex((frame) => frame.from === "client" && frame.message.method === before);
	const frames = end === -1 ? agy.frames : agy.frames.slice(0, end);
	return frames
		.filter((frame) => frame.from === "agent" && frame.message.method === "session/update")
		.map((frame) => fields(fields(frame.message.params).update))
		.filter((update) => update.sessionUpdate === kind);
}

/** The context fill of agy's last `usage_update`; with `before`, the last ahead of the bridge's first such record. */
export function fillOf(agy: RecordedAgy, before?: string): z.infer<typeof Fill> {
	return read(Fill, updatesOf(agy, "usage_update", before).at(-1), "last usage_update");
}

/** The text of the bridge's first `session/prompt`, run together. */
export function promptOf(agy: RecordedAgy): string {
	const prompt = recordsOf(agy, "session/prompt", "client").at(0)?.prompt;
	const blocks: readonly unknown[] = Array.isArray(prompt) ? prompt : [];
	return blocks.map((block) => textOf(fields(block))).join("");
}

/** The token counts agy answered the bridge's first `session/prompt` with. */
export function promptUsage(agy: RecordedAgy): Readonly<Record<string, number>> {
	return read(z.record(z.string(), z.number()), answerTo(agy, "session/prompt").usage, "session/prompt usage");
}

/** The text of agy's chunks of `kind` (`agent_message_chunk`, `agent_thought_chunk`, …), run together. */
export function chunkText(agy: RecordedAgy, kind: string): string {
	return updatesOf(agy, kind)
		.map((update) => textOf(fields(update.content)))
		.join("");
}

function textOf(block: Fields): string {
	return typeof block.text === "string" ? block.text : "";
}

/** The title agy gave the session last. */
export function titleOf(agy: RecordedAgy): string {
	return read(z.string(), updatesOf(agy, "session_info_update").at(-1)?.title, "session title");
}

/** The arguments of agy's first call of the tool `name`, as the call first named them. */
export function toolInput(agy: RecordedAgy, name: string): z.infer<typeof Arguments> {
	const call = updatesOf(agy, "tool_call").find((update) => update.name === name);
	return read(Arguments, call?.rawInput, `${name} call's arguments`);
}

/** The argument `key` of `input`, which must be text. */
export function textArgument(input: z.infer<typeof Arguments>, key: string): string {
	return read(z.string(), input[key], `argument ${key}`);
}

/** agy's first question, its form's `q1`: its words, the titles of its choices, and whether it takes several. */
export function questionOf(agy: RecordedAgy): {
	readonly text: string;
	readonly labels: string[];
	readonly several: boolean;
} {
	const form = fields(recordsOf(agy, "elicitation/create").at(0)?.requestedSchema);
	const question = read(Question, fields(form.properties).q1, "question q1");
	const choices = question.type === "array" ? question.items.anyOf : question.oneOf;
	return { text: question.title, labels: choices.map((choice) => choice.title), several: question.type === "array" };
}

/** The current value of the session's config option `id` in the last of agy's reports of them. */
export function settingOf(agy: RecordedAgy, id: string): string {
	const reports = agy.frames.flatMap(({ from, message }): Array<readonly unknown[]> => {
		if (from !== "agent") return [];
		const options = fields(message.result).configOptions ?? fields(fields(message.params).update).configOptions;
		return Array.isArray(options) ? [options] : [];
	});
	const option = reports.at(-1)?.find((candidate) => fields(candidate).id === id);
	return read(z.string(), fields(option).currentValue, `setting ${id}`);
}
