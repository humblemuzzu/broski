/**
 * Every id the adapter hands the core (contract README §4), in one place: minted live ids, ids derived from the
 * CLI's own (session, entry, message, tool call, agent), and how a prompt's id travels to the CLI and back (D10, D21).
 */

import type { UUID } from "node:crypto";
import type {
	AttachmentId,
	BlockId,
	ClientRequestId,
	CommandId,
	InteractionId,
	MessageId,
	QueueItemId,
	RunId,
	SessionId,
	ToolCallId,
	TranscriptItemId,
} from "../../contract";
import { fitsId } from "./bounds";

/** Random, so no id is ever reused in a session (stream rule 2), also across CLI processes of one session. */
function mint(): string {
	return crypto.randomUUID();
}

export const mintRunId: () => RunId = mint;
/** The CLI's `request_id` of a `can_use_tool` or elicitation is per process; the desk maps it to one of these. */
export const mintInteractionId: () => InteractionId = mint;
export const mintQueueItemId: () => QueueItemId = mint;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claude Code session ids, transcript entry uuids and a send's `uuid` are UUIDs; the SDK refuses anything else. */
export function isUuid(value: string): value is UUID {
	return UUID_PATTERN.test(value);
}

/**
 * D10: the `uuid` of the `SDKUserMessage` that carries a prompt is the prompt's `clientRequestId`. The CLI keeps a
 * send's uuid as its transcript entry's uuid (`sdk.d.ts` `ForkSessionOptions.upToMessageId`), keys its
 * `command_lifecycle` frames and `result.user_message_uuids` by it, so one id names the prompt everywhere: the live
 * `user_message.messageId`, the transcript item id, and the `clientRequestId` the store reads back for prompts the owner
 * journal recorded (`owned.ts`).
 */
export function sendUuid(clientRequestId: ClientRequestId): UUID | undefined {
	return isUuid(clientRequestId) ? clientRequestId : undefined;
}

/** A user entry's transcript item id and its live `user_message.messageId`: the entry uuid itself. */
export function userItemId(entryUuid: string): TranscriptItemId {
	return entryUuid;
}

/**
 * A block of an assistant message: `<message.id>:<index>`, where `index` is the block's position in the API message
 * (the `index` of its `content_block_*` stream events; in history, the order of the entries that share `message.id`).
 * The CLI streams one block per `assistant` frame and gives blocks no id of their own.
 */
export function blockId(messageId: MessageId, index: number): BlockId {
	return `${messageId}:${index}`;
}

interface BlockPart {
	readonly messageId: MessageId;
	readonly index: number;
}

/** Split at the last `:`; undefined for an id `blockId` did not make. */
export function parseBlockId(id: string): BlockPart | undefined {
	const match = /^(.+):(0|[1-9]\d{0,5})$/.exec(id);
	if (!match) return undefined;
	const [, messageId = "", index = ""] = match;
	return { messageId, index: Number(index) };
}

/** A tool call's id is the API's `tool_use` id (`toolu_…`), unique per session; undefined when it does not fit. */
export function toolCallId(toolUseId: string): ToolCallId | undefined {
	return fitsId(toolUseId) ? toolUseId : undefined;
}

/** The transcript item of a tool call's result: the contract's own `<toolCallId>:result`. */
export function toolResultItemId(id: ToolCallId): TranscriptItemId {
	return `${id}:result`;
}

/**
 * An image in a user entry: `<entryUuid>:<blockIndex>` for an image block of `message.content`, and
 * `<entryUuid>:<blockIndex>:<innerIndex>` for an image inside the `tool_result` block at `blockIndex`.
 */
export function imageAttachmentId(entryUuid: string, blockIndex: number, innerIndex?: number): AttachmentId {
	return innerIndex === undefined ? `${entryUuid}:${blockIndex}` : `${entryUuid}:${blockIndex}:${innerIndex}`;
}

export interface ImagePart {
	readonly entryUuid: string;
	readonly blockIndex: number;
	readonly innerIndex?: number;
}

export function parseImageAttachmentId(id: string): ImagePart | undefined {
	const match = /^([0-9a-fA-F-]{36}):(0|[1-9]\d{0,5})(?::(0|[1-9]\d{0,5}))?$/.exec(id);
	if (!match) return undefined;
	const [, entryUuid = "", block = "", inner] = match;
	if (!isUuid(entryUuid)) return undefined;
	return { entryUuid, blockIndex: Number(block), ...(inner !== undefined && { innerIndex: Number(inner) }) };
}

const CHILD_SEPARATOR = "/";
const AGENT_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * The session a subagent is shown as (D20): `<sessionId>/<agentId>`, the parent's session id and the CLI's agent id
 * (the `agent_id` of its frames and the `task_id` of its task events). Undefined when either is not one the CLI makes.
 */
export function childRef(sessionId: SessionId, agentId: string): SessionId | undefined {
	return isUuid(sessionId) && AGENT_ID.test(agentId) ? `${sessionId}${CHILD_SEPARATOR}${agentId}` : undefined;
}

export interface ChildPart {
	readonly parentId: SessionId;
	readonly agentId: string;
}

export function parseChildRef(id: string): ChildPart | undefined {
	const at = id.indexOf(CHILD_SEPARATOR);
	if (at < 0) return undefined;
	const parentId = id.slice(0, at);
	const agentId = id.slice(at + 1);
	return isUuid(parentId) && AGENT_ID.test(agentId) ? { parentId, agentId } : undefined;
}

/** A slash command or skill is listed under its name without the slash (`SlashCommand.name`). */
export function commandId(name: string): CommandId | undefined {
	const bare = name.replace(/^\//, "");
	return fitsId(bare) && !/\s/.test(bare) ? bare : undefined;
}

/** D11: `PromptInput.command` becomes `/<name> <args>` in the prompt's text. */
export function commandText(id: CommandId, args: string): string {
	return args === "" ? `/${id}` : `/${id} ${args}`;
}
