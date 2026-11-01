/** A `user` transcript line: a person's prompt, a tool's result, or the marker of an interruption. */

import { MAX_TEXT_CHARS } from "../../../contract";
import { clip, fitsId } from "../bounds";
import { toolCallId, userItemId } from "../ids";
import { isRecord } from "../json";
import { imageRefsOf } from "../mapping/images";
import { toolResultOf } from "../mapping/tool-results";
import type { MappedEvent } from "../ports/mapping";
import type { TranslatorState } from "./translate-state";

const INTERRUPT_MARKER = "[Request interrupted by user";
/** The CLI's own tags are short and come first; a person's long text is never scanned past this for one. */
const SCAN_CHARS = 4_096;
const LOCAL_OUTPUT = "<local-command-stdout>";
const TAG_START = /^\s*<[a-z][\w-]*[\s>]/;
const COMMAND_NAME = /<command-name>(.*?)<\/command-name>/s;
const COMMAND_ARGS = /<command-args>(.*?)<\/command-args>/s;

export function userEvents(state: TranslatorState, entry: Record<string, unknown>, uuid: string): MappedEvent[] {
	if (entry.isSidechain === true || entry.isMeta === true || entry.isCompactSummary === true) return [];
	const message = entry.message;
	if (!isRecord(message)) return [];
	const content = message.content;
	const blocks = Array.isArray(content) ? content : [];
	const out: MappedEvent[] = [];
	resultEvents(state, out, blocks, entry.toolUseResult, uuid);
	const text = typeof content === "string" ? content : textOf(blocks);
	if (text !== undefined) promptEvents(state, out, text, content, uuid);
	return out;
}

function textOf(blocks: readonly unknown[]): string | undefined {
	const texts = blocks.flatMap((block) =>
		isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : [],
	);
	return texts.length === 0 ? undefined : texts.join("\n");
}

function resultEvents(
	state: TranslatorState,
	out: MappedEvent[],
	blocks: readonly unknown[],
	toolUseResult: unknown,
	uuid: string,
): void {
	const results = blocks.filter((block) => isRecord(block) && block.type === "tool_result");
	blocks.forEach((block, blockIndex) => {
		if (!isRecord(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") return;
		const id = toolCallId(block.tool_use_id);
		const open = id === undefined ? undefined : state.tools.get(id);
		if (id === undefined || open === undefined) return;
		const mapping = toolResultOf(
			block,
			results.length === 1 ? toolUseResult : undefined,
			{ entryUuid: uuid, blockIndex },
			open.name,
		);
		state.tools.delete(id);
		out.push({
			event: {
				type: "tool_finished",
				toolCallId: id,
				outcome: mapping.outcome,
				result: mapping.result,
			},
		});
	});
}

function promptEvents(state: TranslatorState, out: MappedEvent[], raw: string, content: unknown, uuid: string): void {
	const prompt = classify(raw);
	if (prompt === undefined || !fitsId(uuid)) return;
	if (prompt.kind !== "prompt") {
		state.finishRun(out, prompt.kind === "interrupt" ? "aborted" : "completed");
		return;
	}
	if (state.settled) state.finishRun(out, "completed");
	state.startRun(out);
	state.lastStop = undefined;
	out.push({
		event: {
			type: "user_message",
			messageId: userItemId(uuid),
			text: clip(prompt.text, MAX_TEXT_CHARS),
			attachments: imageRefsOf(content, uuid),
		},
	});
}

/** `local_output`: a slash command the CLI ran itself has printed its result, which is all the turn there is. */
type UserText = { readonly kind: "interrupt" | "local_output" } | { readonly kind: "prompt"; readonly text: string };

/** What a user line says; undefined for the CLI's own notes (system reminders, command output) that are no prompt. */
function classify(raw: string): UserText | undefined {
	const trimmed = raw.slice(0, SCAN_CHARS).trim();
	if (trimmed.startsWith(INTERRUPT_MARKER)) return { kind: "interrupt" };
	if (trimmed.startsWith(LOCAL_OUTPUT)) return { kind: "local_output" };
	if (!TAG_START.test(trimmed)) return trimmed === "" ? undefined : { kind: "prompt", text: raw };
	const name = COMMAND_NAME.exec(trimmed)?.[1]?.trim();
	if (name === undefined || name === "") return undefined;
	const args = COMMAND_ARGS.exec(trimmed)?.[1]?.trim();
	return {
		kind: "prompt",
		text: args === undefined || args === "" ? name : `${name} ${args}`,
	};
}
