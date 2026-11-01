/**
 * The newest user message of a session's newest main request, read back as the suite's `DeliveredInput` (rule 13).
 * D10's wire forms are parsed back: `@agent-<name>` and `@<path>` mentions, a slash command's `<command-name>` tag
 * (the CLI's expansion; unverified until Step 5 runs it). Image names never reach a model, so they come from the
 * transcript's `ImageRef`s, which the store reads from the owner journal (D37).
 */

import type { AgentBackend, Attachment, Mention, SessionRef } from "../../../contract";
import type { DeliveredInput } from "../../../contract/testing/conformance-types";
import type { ScriptedRequest } from "../../helpers/scripted-anthropic-server";

interface WireBlock {
	readonly type?: unknown;
	readonly text?: unknown;
	readonly source?: { readonly media_type?: unknown; readonly data?: unknown };
}

const AGENT_MENTION = /@agent-([A-Za-z0-9_.-]+)/g;
const FILE_MENTION = /(?:^|\s)@(?!agent-)(\S+)/g;
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
	const mentions: Mention[] = [
		...[...raw.matchAll(AGENT_MENTION)].map((match): Mention => ({ kind: "agent", name: match[1] ?? "" })),
		...[...raw.matchAll(FILE_MENTION)].map((match): Mention => ({ kind: "file", path: match[1] ?? "" })),
	];
	const command = COMMAND.exec(typed.join("\n"))?.[1];
	return { text: raw.trim(), attachments, mentions, ...(command !== undefined && { command }) };
}

function lastUserBlocks(body: unknown): WireBlock[] | undefined {
	if (typeof body !== "object" || body === null || !("messages" in body) || !Array.isArray(body.messages)) return;
	const last: unknown = body.messages.at(-1);
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
