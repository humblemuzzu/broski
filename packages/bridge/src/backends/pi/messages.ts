/**
 * Pi's messages and their content blocks as the adapter reads them, from `pi --mode rpc` frames (validated by
 * `rpc/frames.ts`) and from session files (`store/`): only the fields it uses, named as pi-coding-agent 1.5.2
 * `docs/message-types.md` names them. A content block of a type Pi adds later is `UnsupportedContent`, so it keeps
 * its place: an image is named by its index in the message (`ids.ts`, `entryAttachmentId`).
 */

export interface TextContent {
	readonly type: "text";
	readonly text: string;
}

export interface ImageContent {
	readonly type: "image";
	/** Base64. */
	readonly data: string;
	readonly mimeType: string;
}

export interface ThinkingContent {
	readonly type: "thinking";
	readonly thinking: string;
}

export interface ToolCall {
	readonly type: "toolCall";
	readonly id: string;
	readonly name: string;
	readonly arguments: Readonly<Record<string, unknown>>;
}

export interface UnsupportedContent {
	readonly type: "unsupported";
}

export type UserContent = string | readonly (TextContent | ImageContent | UnsupportedContent)[];

export interface UserMessage {
	readonly role: "user";
	readonly content: UserContent;
	readonly timestamp: number;
}

export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

export interface AssistantMessage {
	readonly role: "assistant";
	readonly content: readonly (TextContent | ThinkingContent | ToolCall | UnsupportedContent)[];
	readonly stopReason: StopReason;
	readonly errorMessage?: string | undefined;
	readonly timestamp: number;
}

export interface ToolResultMessage {
	readonly role: "toolResult";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly content: readonly (TextContent | ImageContent | UnsupportedContent)[];
	readonly details?: unknown;
	readonly isError: boolean;
	readonly timestamp: number;
}

/** What an extension sends with `pi.sendMessage()`. */
export interface CustomMessage {
	readonly role: "custom";
	readonly content: UserContent;
	readonly display: boolean;
	readonly timestamp: number;
}

/** A terminal's `!` command, which is no tool call (`docs/message-types.md`, BashExecutionMessage). */
export interface BashExecutionMessage {
	readonly role: "bashExecution";
	readonly command: string;
	readonly output: string;
	readonly exitCode: number | undefined;
	readonly cancelled: boolean;
	readonly truncated: boolean;
	readonly fullOutputPath?: string | undefined;
	readonly excludeFromContext?: boolean | undefined;
	readonly timestamp: number;
}

/** A message the adapter shows nothing of: the system prompt, summaries, a role a later Pi adds. */
export interface OtherMessage {
	readonly role: "other";
}

export type PiMessage =
	| UserMessage
	| AssistantMessage
	| ToolResultMessage
	| CustomMessage
	| BashExecutionMessage
	| OtherMessage;

/** The text blocks of `content` joined by `separator`, as Pi's `contentText` joins them (pi-ai `dist/utils/text.js:2-9`). */
export function contentText(content: UserContent, separator = "\n"): string {
	if (typeof content === "string") return content;
	return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(separator);
}
