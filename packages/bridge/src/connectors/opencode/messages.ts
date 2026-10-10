import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	FilePartInput,
	FilePartSource,
	OutputFormat,
	Part,
	SessionMessageResponse,
	TextPartInput,
} from "@opencode-ai/sdk/v2";
import type { FileAttachment, Todo } from "../../types";
import type { OpenCodeContext } from "./context";

function buildPromptParts(
	content: string,
	directory: string | undefined,
	fileAttachments?: FileAttachment[],
): Array<TextPartInput | FilePartInput> {
	const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: content }];

	if (fileAttachments && fileAttachments.length > 0) {
		const baseDir = directory ?? process.cwd();
		for (const attachment of fileAttachments) {
			if (attachment.base64Data && attachment.mimeType) {
				parts.push({
					type: "file" as const,
					url: `data:${attachment.mimeType};base64,${attachment.base64Data}`,
					filename: basename(attachment.path || "image"),
					mime: attachment.mimeType,
				});
			} else {
				const absolutePath = isAbsolute(attachment.path) ? attachment.path : join(baseDir, attachment.path);
				const filename = basename(attachment.path) || attachment.path;
				parts.push({
					type: "file" as const,
					url: pathToFileURL(absolutePath).href,
					filename: attachment.isDirectory ? `${filename}/` : filename,
					mime: attachment.isDirectory ? "inode/directory" : "text/plain",
				});
			}
		}
	}

	return parts;
}

export async function getSessionMessages(
	ctx: OpenCodeContext,
	sessionId: string,
	directory?: string,
	limit?: number,
	before?: string,
) {
	const { data } = await ctx.client.session.messages({
		sessionID: sessionId,
		directory,
		limit,
		...(before ? { before } : {}),
	});
	return data;
}

export async function sendPrompt(
	ctx: OpenCodeContext,
	sessionId: string,
	content: string,
	directory?: string,
	messageId?: string,
	model?: { providerID: string; modelID: string },
	agent?: string,
	fileAttachments?: FileAttachment[],
	variant?: string,
	noReply?: boolean,
	system?: string,
) {
	const parts = buildPromptParts(content, directory, fileAttachments);

	return ctx.client.session.prompt({
		sessionID: sessionId,
		directory,
		...(messageId ? { messageID: messageId } : {}),
		...(model ? { model } : {}),
		...(agent ? { agent } : {}),
		...(variant ? { variant } : {}),
		...(noReply !== undefined ? { noReply } : {}),
		...(system ? { system } : {}),
		parts,
	});
}

export async function sendPromptAsync(
	ctx: OpenCodeContext,
	sessionId: string,
	content: string,
	directory?: string,
	model?: { providerID: string; modelID: string },
	agent?: string,
	fileAttachments?: FileAttachment[],
	variant?: string,
	noReply?: boolean,
	system?: string,
	format?: OutputFormat,
) {
	const parts = buildPromptParts(content, directory, fileAttachments);

	return ctx.client.session.promptAsync({
		sessionID: sessionId,
		directory,
		...(model ? { model } : {}),
		...(agent ? { agent } : {}),
		...(variant ? { variant } : {}),
		...(noReply !== undefined ? { noReply } : {}),
		...(system ? { system } : {}),
		...(format ? { format } : {}),
		parts,
	});
}

export async function executeCommand(
	ctx: OpenCodeContext,
	sessionId: string,
	command: string,
	args: string,
	directory?: string,
	agent?: string,
	model?: string,
	variant?: string,
	parts?: Array<{ id?: string; type: "file"; mime: string; filename?: string; url: string; source?: FilePartSource }>,
): Promise<unknown> {
	const { data } = await ctx.client.session.command({
		sessionID: sessionId,
		directory,
		command,
		arguments: args,
		...(agent ? { agent } : {}),
		...(model ? { model } : {}),
		...(variant ? { variant } : {}),
		...(parts && parts.length > 0 ? { parts } : {}),
	});
	return data;
}

export async function shellCommand(
	ctx: OpenCodeContext,
	sessionId: string,
	command: string,
	directory?: string,
	agent?: string,
	model?: { providerID: string; modelID: string },
	messageId?: string,
) {
	const { data } = await ctx.client.session.shell({
		sessionID: sessionId,
		directory,
		command,
		...(agent ? { agent } : {}),
		...(model ? { model } : {}),
		...(messageId ? { messageID: messageId } : {}),
	});
	return data;
}

export async function deletePart(
	ctx: OpenCodeContext,
	sessionId: string,
	messageId: string,
	partId: string,
	directory?: string,
): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.part.delete({
			sessionID: sessionId,
			messageID: messageId,
			partID: partId,
			directory,
		});
		return result === true;
	} catch {
		return false;
	}
}

export async function updatePart(
	ctx: OpenCodeContext,
	sessionId: string,
	messageId: string,
	partId: string,
	part: Part,
	directory?: string,
): Promise<Part | null> {
	try {
		const { data: result } = await ctx.client.part.update({
			sessionID: sessionId,
			messageID: messageId,
			partID: partId,
			directory,
			part,
		});
		return result ?? null;
	} catch {
		return null;
	}
}

export async function deleteMessage(
	ctx: OpenCodeContext,
	sessionId: string,
	messageId: string,
	directory?: string,
): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.session.deleteMessage({
			sessionID: sessionId,
			messageID: messageId,
			directory,
		});
		return result === true;
	} catch {
		return false;
	}
}

export async function getMessage(
	ctx: OpenCodeContext,
	sessionId: string,
	messageId: string,
	directory?: string,
): Promise<SessionMessageResponse | null> {
	try {
		const { data: result } = await ctx.client.session.message({
			sessionID: sessionId,
			messageID: messageId,
			directory,
		});
		return result ?? null;
	} catch {
		return null;
	}
}

export async function getTodos(ctx: OpenCodeContext, sessionId: string, directory?: string): Promise<Todo[]> {
	try {
		const { data: todos } = await ctx.client.session.todo({ sessionID: sessionId, directory });
		return (todos ?? []).map((todo: any) => ({
			content: todo.content ?? "",
			status: todo.status ?? "pending",
			priority: todo.priority ?? "medium",
		}));
	} catch {
		return [];
	}
}
