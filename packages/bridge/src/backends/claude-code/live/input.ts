/** A `PromptInput` as the `SDKUserMessage` it is sent as (D11): images base64, human-stamped (D10). */

import type { UUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isRejected, rejected } from "../../../adapter-kit/rejections";
import {
	type Attachment,
	type ImageRef,
	MAX_TEXT_CHARS,
	type PromptInput,
	type Rejected,
	type UserMessageEvent,
} from "../../../contract";
import { clip } from "../bounds";
import { commandId, commandText, imageAttachmentId, userItemId } from "../ids";

type Content = SDKUserMessage["message"]["content"];
type Block = Exclude<Content, string>[number];
type ImageBlock = Extract<Block, { type: "image" }>;
type MediaType = Extract<ImageBlock["source"], { type: "base64" }>["media_type"];
type Image = Extract<Attachment, { kind: "image" }>;

export type SendPriority = "now" | "next" | "later";

/** A prompt ready to go to the CLI, with what the contract shows of it. */
export interface PreparedSend {
	readonly uuid: UUID;
	readonly message: SDKUserMessage;
	/** What the model is sent, the command with its arguments; it goes back to the composer when the person stops the run before it was delivered. */
	readonly text: string;
	readonly imageNames: readonly (string | undefined)[];
	/** The `user_message` the contract shows when this reaches the model. */
	readonly event: UserMessageEvent;
}

function mediaTypeOf(mimeType: string): MediaType | undefined {
	switch (mimeType) {
		case "image/jpeg":
		case "image/png":
		case "image/gif":
		case "image/webp":
			return mimeType;
		default:
			return undefined;
	}
}

function textOf(input: PromptInput): string | Rejected {
	if (input.command === undefined) return input.text;
	const id = commandId(input.command);
	return id === undefined
		? rejected("invalid_input", "the command is not one Claude Code lists")
		: commandText(id, input.text.trim());
}

function imageBlocks(images: readonly Image[]): ImageBlock[] | Rejected {
	const blocks: ImageBlock[] = [];
	for (const image of images) {
		const media_type = mediaTypeOf(image.mimeType);
		if (media_type === undefined) {
			return rejected("invalid_input", `Claude Code reads jpeg, png, gif and webp images, not ${image.mimeType}`);
		}
		blocks.push({
			type: "image",
			source: { type: "base64", media_type, data: image.data },
		});
	}
	return blocks;
}

function imagesOf(input: PromptInput): Image[] | Rejected {
	const images: Image[] = [];
	for (const attachment of input.attachments) {
		if (attachment.kind === "file") {
			return rejected("unsupported", "Claude Code takes a file as a mention, not as an attachment");
		}
		images.push(attachment);
	}
	return images;
}

function userMessage(uuid: UUID, content: Content): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content },
		parent_tool_use_id: null,
		origin: { kind: "human" },
		uuid,
	};
}

function textBlock(text: string): Block {
	return { type: "text", text };
}

function refsOf(images: readonly Image[], firstImageBlock: number, uuid: UUID): ImageRef[] {
	return images.map((image, index) => ({
		kind: "image_ref",
		id: imageAttachmentId(uuid, firstImageBlock + index),
		mimeType: image.mimeType,
		...(image.name !== undefined && { name: image.name }),
	}));
}

/** `send` as it goes to the CLI with `priority`: a steer pushes with `next` (D9). */
export function withPriority(send: PreparedSend, priority: SendPriority): PreparedSend {
	return { ...send, message: { ...send.message, priority } };
}

/** Refuses what Claude Code cannot be sent, so nothing is ever dropped (conformance rule 13). */
export function userMessageOf(input: PromptInput, uuid: UUID): PreparedSend | Rejected {
	const images = imagesOf(input);
	if (isRejected(images)) return images;
	const blocks = imageBlocks(images);
	if (isRejected(blocks)) return blocks;
	const text = textOf(input);
	if (typeof text !== "string") return text;
	const hasText = text.trim() !== "";
	if (!hasText && blocks.length === 0) return rejected("invalid_input", "there is nothing to send");
	const content: Content = blocks.length === 0 ? text : [...(hasText ? [textBlock(text)] : []), ...blocks];
	return {
		uuid,
		message: userMessage(uuid, content),
		text,
		imageNames: images.map((image) => image.name),
		event: {
			type: "user_message",
			messageId: userItemId(uuid),
			text: clip(text, MAX_TEXT_CHARS),
			attachments: refsOf(images, hasText ? 1 : 0, uuid),
			clientRequestId: uuid,
		},
	};
}
