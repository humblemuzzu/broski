/** Lane B · `user` frames: tool results (`tool_finished`), and prompts this host did not send (`user_message`). */

import type { SDKUserMessage, SDKUserMessageReplay } from "@anthropic-ai/claude-agent-sdk";
import { MAX_TEXT_CHARS } from "../../../contract";
import { clip, fitsId } from "../bounds";
import { toolCallId, userItemId } from "../ids";
import type { MappedEvent } from "../ports/mapping";
import { fileChangesOf } from "./file-changes";
import { imageRefsOf } from "./images";
import { fanOut, placementOf } from "./routing";
import type { MapperState } from "./state";
import { endTool } from "./tool-calls";
import { toolResultOf } from "./tool-results";

type UserFrame = SDKUserMessage;
type Blocks = Exclude<UserFrame["message"]["content"], string>;
type ToolResultBlock = Extract<Blocks[number], { type: "tool_result" }>;

/** Text the CLI writes into the conversation itself: an interrupt marker, a slash command's echo or output. */
const CLI_TEXT_PREFIXES: readonly string[] = [
	"[Request interrupted by user",
	"<command-name>",
	"<local-command-",
	"<command-",
];

function toolResults(content: UserFrame["message"]["content"]): { block: ToolResultBlock; index: number }[] {
	if (typeof content === "string") return [];
	return content.flatMap((block, index) => (block.type === "tool_result" ? [{ block, index }] : []));
}

function textOf(content: UserFrame["message"]["content"]): string {
	if (typeof content === "string") return content;
	return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function toolResultEvents(
	state: MapperState,
	frame: UserFrame,
	results: ReturnType<typeof toolResults>,
): MappedEvent[] {
	const structured = results.length === 1 ? frame.tool_use_result : undefined;
	return results.flatMap(({ block, index }) => {
		const id = toolCallId(block.tool_use_id);
		const open = id === undefined ? undefined : state.openTools.get(id);
		if (id === undefined || open === undefined) return [];
		const mapped = toolResultOf(block, structured, { entryUuid: frame.uuid ?? "", blockIndex: index }, open.name);
		const outcome = mapped.outcome === "failed" && state.denied.has(id) ? "denied" : mapped.outcome;
		const changes =
			mapped.outcome === "completed" && mapped.result.fileChanges.length === 0
				? fileChangesOf(open.name, open.input, structured)
				: mapped.result.fileChanges;
		return endTool(state, id, outcome, {
			...mapped.result,
			fileChanges: changes,
		});
	});
}

/** A prompt the host did not send: someone else's turn in this session. The CLI's own text is not a prompt. */
function promptEvents(state: MapperState, frame: UserFrame): MappedEvent[] {
	const placement = placementOf(state, {
		agentId: frame.agent_id,
		parentToolUseId: frame.parent_tool_use_id,
	});
	const uuid: unknown = frame.uuid;
	if (typeof uuid !== "string" || !fitsId(uuid) || placement.streams.length === 0 || state.ownSends.has(uuid))
		return [];
	if (frame.isSynthetic === true || (frame.origin !== undefined && frame.origin.kind !== "human")) return [];
	const text = textOf(frame.message.content);
	if (CLI_TEXT_PREFIXES.some((prefix) => text.startsWith(prefix))) return [];
	const attachments = imageRefsOf(frame.message.content, uuid);
	if (text.trim() === "" && attachments.length === 0) return [];
	const streams =
		frame.agent_id === undefined ? placement.streams : placement.streams.filter((stream) => stream === placement.own);
	return fanOut(streams, () => ({
		type: "user_message",
		messageId: userItemId(uuid),
		text: clip(text, MAX_TEXT_CHARS),
		attachments,
	}));
}

/** A replay (`isReplay`) echoes a send or a local command's output; the host owns its sends, so it shows nothing. */
export function userEvents(state: MapperState, frame: SDKUserMessage | SDKUserMessageReplay): MappedEvent[] {
	if ("isReplay" in frame) return [];
	const results = toolResults(frame.message.content);
	return results.length > 0 ? toolResultEvents(state, frame, results) : promptEvents(state, frame);
}
