/**
 * A `user` transcript line: a person's prompt, a tool's result, or what the CLI wrote there itself: an interruption, a
 * command's output, a background task's end (`harnessText`).
 */

import { type Activity, type AttachmentRef, MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "../../../contract";
import { clip, fitsId } from "../bounds";
import { toolCallId, userItemId } from "../ids";
import { isRecord } from "../json";
import { commandOutputActivity, savedTaskActivity, shellOutputActivity } from "../mapping/activities";
import { harnessText } from "../mapping/harness-text";
import { extractUserImagePaths, stripImagePlaceholders } from "../mapping/image-paths";
import { imageRefsOf } from "../mapping/images";
import { toolResultOf } from "../mapping/tool-results";
import type { MappedEvent } from "../ports/mapping";
import type { TranslatorState } from "./translate-state";

export function userEvents(state: TranslatorState, entry: Record<string, unknown>, uuid: string): MappedEvent[] {
	if (entry.isSidechain === true || entry.isMeta === true || entry.isCompactSummary === true) return [];
	const message = entry.message;
	if (!isRecord(message)) return [];
	const content = message.content;
	const blocks = Array.isArray(content) ? content : [];
	const out: MappedEvent[] = [];
	resultEvents(state, out, blocks, entry.toolUseResult, uuid);
	const text = typeof content === "string" ? content : textOf(blocks);
	const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
	const cwd = typeof entry.cwd === "string" ? entry.cwd : undefined;
	const hasImages = imageRefsOf(content, uuid).length > 0;
	if (text !== undefined || hasImages) saidEvents(state, out, { text: text ?? "", content, uuid, sessionId, cwd });
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

interface UserLine {
	readonly text: string;
	readonly content: unknown;
	readonly uuid: string;
	readonly sessionId: string | undefined;
	readonly cwd: string | undefined;
}

/**
 * A prompt starts a run; an interrupt ends it. A command the CLI ran itself (a slash command, a `!` escape) has printed
 * its result, which is all the turn there is. A background task's end is reported in whatever run is under way.
 */
function saidEvents(state: TranslatorState, out: MappedEvent[], line: UserLine): void {
	if (!fitsId(line.uuid)) return;
	const said = harnessText(line.text);
	switch (said.kind) {
		case "context":
			if (imageRefsOf(line.content, line.uuid).length > 0) promptEvents(state, out, "", line);
			return;
		case "interrupt":
			state.finishRun(out, "aborted");
			return;
		case "task":
			pushActivity(out, line.uuid, savedTaskActivity(said.notification, line.sessionId));
			return;
		case "command_output":
			pushActivity(out, line.uuid, commandOutputActivity(said.text, said.failed));
			state.finishRun(out, "completed");
			return;
		case "shell_output":
			pushActivity(out, line.uuid, shellOutputActivity(said.stdout, said.stderr));
			state.finishRun(out, "completed");
			return;
		case "prompt":
			promptEvents(state, out, said.text, line);
	}
}

function pushActivity(out: MappedEvent[], uuid: string, activity: Activity | undefined): void {
	if (activity !== undefined) out.push({ event: { type: "activity", activityId: userItemId(uuid), activity } });
}

function promptEvents(state: TranslatorState, out: MappedEvent[], text: string, line: UserLine): void {
	if (state.settled) state.finishRun(out, "completed");
	state.startRun(out);
	state.lastStop = undefined;
	const refs = imageRefsOf(line.content, line.uuid);
	const displayText = refs.length > 0 ? stripImagePlaceholders(text) : text;
	const attachments: AttachmentRef[] =
		refs.length > 0 ? refs : extractUserImagePaths(displayText, line.cwd).slice(0, MAX_LIST_ITEMS);
	out.push({
		event: {
			type: "user_message",
			messageId: userItemId(line.uuid),
			text: clip(displayText, MAX_TEXT_CHARS),
			attachments,
		},
	});
}
