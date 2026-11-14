/**
 * The newest user message of a session's newest main request, read back as the suite's `DeliveredInput` (rule 13).
 * CLI 2.1.316 puts a `system`-role "# Environment" message after the first user message, so the last message whose
 * role is `user` is read, not the last message. D10's wire form of a slash command, its `<command-name>` tag, is parsed
 * back. Image names never reach a model, so they come from the
 * transcript's `ImageRef`s, which the store reads from the owner journal (D37).
 */

import type { AgentBackend, Attachment, SessionRef } from "../../../contract";
import type { DeliveredInput } from "../../../contract/testing/conformance-types";
import type { ScriptedRequest } from "../../helpers/scripted-anthropic-server";

interface WireBlock {
	readonly type?: unknown;
	readonly text?: unknown;
	readonly source?: { readonly media_type?: unknown; readonly data?: unknown };
}

const COMMAND = /<command-name>\/?([^<\s]+)<\/command-name>/;

export async function deliveredInput(
	backend: Pick<AgentBackend, "readTranscript">,
	request: ScriptedRequest | undefined,
	session: SessionRef,
): Promise<DeliveredInput | undefined> {
	const blocks = request && lastUserBlocks(request.body);
	if (!blocks) return undefined;
	const typed = blocks.flatMap((block) =>
		block.type === "text" && typeof block.text === "string" ? [block.text] : [],
	);
	const raw = typed.filter((text) => !text.trimStart().startsWith("<system-reminder>")).join("\n");
	const names = await imageNames(backend, session);
	const images = blocks.filter((block) => block.type === "image");
	const attachments: Attachment[] = images.flatMap((block, index): Attachment[] => {
		const { media_type: mimeType, data } = block.source ?? {};
		if (typeof mimeType !== "string" || typeof data !== "string") return [];
		const name = names[index];
		return [{ kind: "image", mimeType, data, ...(name !== undefined && { name }) }];
	});
	const command = COMMAND.exec(typed.join("\n"))?.[1];
	return { text: raw.trim(), attachments, ...(command !== undefined && { command }) };
}

function lastUserBlocks(body: unknown): WireBlock[] | undefined {
	if (typeof body !== "object" || body === null || !("messages" in body) || !Array.isArray(body.messages)) return;
	const last: unknown = body.messages.findLast(
		(message: unknown) =>
			typeof message === "object" && message !== null && "role" in message && message.role === "user",
	);
	if (typeof last !== "object" || last === null || !("content" in last)) return undefined;
	const { content } = last;
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content)
		? content.filter((block): block is WireBlock => typeof block === "object" && block !== null)
		: undefined;
}

async function imageNames(backend: Pick<AgentBackend, "readTranscript">, session: SessionRef) {
	const read = await backend.readTranscript(session, { limit: 200 });
	if (read.status === "rejected") return [];
	const prompt = read.page.items.find((item) => item.kind === "user_message");
	if (prompt?.kind !== "user_message") return [];
	return prompt.attachments.flatMap((attachment) => (attachment.kind === "image_ref" ? [attachment.name] : []));
}
