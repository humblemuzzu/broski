/**
 * What reached the scripted model: the newest user message of the session's newest request, read back as the
 * conformance suite's `DeliveredInput`. OpenAI's chat format carries an image as a `data:` URL.
 */

import { commandId } from "../../../backends/pi/command-ids";
import type { AgentBackend, Attachment, SessionRef } from "../../../contract";
import type { DeliveredInput } from "../../../contract/testing/conformance-types";
import type { ScriptedRequest } from "../../helpers/scripted-openai-server";
import { textOf } from "./pi-router";
import { TEMPLATE_MARKER, TEMPLATE_NAME } from "./pi-world";

interface SentImage {
	readonly mimeType: string;
	readonly data: string;
}

/**
 * An image's `name` is never sent to a model, so it comes from the transcript's `ImageRef` of the same index: what the
 * adapter recorded for the prompt.
 */
export async function deliveredInput(
	backend: Pick<AgentBackend, "readTranscript">,
	request: ScriptedRequest | undefined,
	session: SessionRef,
): Promise<DeliveredInput | undefined> {
	const user = request?.messages.findLast((message) => message.role === "user");
	if (!user) return undefined;
	const raw = textOf(user.content);
	const images = imagesOf(user.content);
	const names = images.length > 0 ? await imageNames(backend, session, raw) : [];
	const attachments: Attachment[] = images.map((image, index) => {
		const name = names[index];
		return { kind: "image", mimeType: image.mimeType, data: image.data, ...(name !== undefined && { name }) };
	});
	const command = raw.startsWith(TEMPLATE_MARKER) ? commandId({ source: "template", name: TEMPLATE_NAME }) : undefined;
	const text = command === undefined ? raw : raw.slice(TEMPLATE_MARKER.length).replace(/^ /, "");
	return { text, attachments, ...(command !== undefined && { command }) };
}

function imagesOf(content: unknown): SentImage[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) => {
		const url = part?.type === "image_url" ? part.image_url?.url : undefined;
		const match = typeof url === "string" ? /^data:([^;]+);base64,(.*)$/.exec(url) : null;
		return match ? [{ mimeType: match[1] ?? "", data: match[2] ?? "" }] : [];
	});
}

async function imageNames(
	backend: Pick<AgentBackend, "readTranscript">,
	session: SessionRef,
	raw: string,
): Promise<(string | undefined)[]> {
	const read = await backend.readTranscript(session, { limit: 200 });
	if (read.status === "rejected")
		throw new Error(`delivered(): the transcript cannot be read: ${read.rejection.message}`);
	const item = read.page.items.find((candidate) => candidate.kind === "user_message" && candidate.text === raw);
	if (item?.kind !== "user_message") {
		throw new Error("delivered(): the transcript has no user message with the text the model received");
	}
	return item.attachments.flatMap((attachment) => (attachment.kind === "image_ref" ? [attachment.name] : []));
}
