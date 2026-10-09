import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { normalizeCwd } from "../connectors/pi/pi-cwd";
import type { FileAttachment, ServerMessage } from "../types";

export type Reply = (message: ServerMessage) => void;

export type Broadcast = (message: ServerMessage) => void;

export type PiHandlerContext = {
	cwd: string;
	optionalCwd: string | undefined;
	reply: Reply;
	broadcast: Broadcast;
};

export const resolveOptionalCwd = (message: any): string | undefined => {
	const projectPath = typeof message?.projectPath === "string" ? message.projectPath : undefined;
	if (projectPath && projectPath.trim().length > 0) {
		return normalizeCwd(projectPath);
	}

	const cwd = typeof message?.cwd === "string" ? message.cwd : undefined;
	if (cwd && cwd.trim().length > 0) {
		return normalizeCwd(cwd);
	}

	return undefined;
};

export const parseThinkingLevel = (value: unknown): ThinkingLevel => {
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	switch (normalized) {
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
		case "max":
			return normalized;
		default:
			throw new Error(`Invalid Pi thinking level: ${String(value)}`);
	}
};

export const parseQueueMode = (value: unknown): "all" | "one-at-a-time" => {
	if (value === "all" || value === "one-at-a-time") {
		return value;
	}
	throw new Error(`Invalid Pi queue mode: ${String(value)}`);
};

export const extractImages = (attachments: FileAttachment[] | undefined) => {
	if (!attachments || attachments.length === 0) return undefined;

	const images = attachments
		.filter((attachment): attachment is FileAttachment & { base64Data: string; mimeType: string } =>
			Boolean(attachment.mimeType?.startsWith("image/") && attachment.base64Data),
		)
		.map((attachment) => ({
			type: "image" as const,
			data: attachment.base64Data,
			mimeType: attachment.mimeType,
		}));

	return images.length > 0 ? images : undefined;
};

export const extractTaggedPaths = (attachments: FileAttachment[] | undefined): string[] => {
	if (!attachments || attachments.length === 0) return [];

	return attachments
		.filter((attachment) => !attachment.base64Data && typeof attachment.path === "string")
		.map((attachment) => attachment.path.trim())
		.filter((path) => path.length > 0);
};

export const composePromptWithTaggedPaths = (prompt: string, taggedPaths: string[]): string => {
	if (taggedPaths.length === 0) return prompt;

	const tags = taggedPaths.map((path) => `@${path}`).join("\n");
	if (prompt.includes(tags)) return prompt;

	return `${prompt}\n\nReferenced project paths:\n${tags}`;
};
