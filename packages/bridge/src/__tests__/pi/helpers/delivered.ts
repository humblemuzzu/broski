/**
 * What reached the faux model: the newest user message of the session's newest request, read back
 * as the conformance suite's `DeliveredInput`.
 */

import { commandId } from "../../../backends/pi/command-ids";
import type { AgentBackend, Attachment, SessionRef } from "../../../contract";
import type { DeliveredInput } from "../../../contract/testing/conformance-types";
import { type FauxRouter, newestUserMessage } from "./faux-router";
import { TEMPLATE_MARKER, TEMPLATE_NAME } from "./pi-world";

/**
 * An image's `name` is never sent to a model (pi-ai `ImageContent` is `{type, data, mimeType}`), so it
 * comes from the transcript's `ImageRef` of the same index: what the adapter recorded for the prompt.
 */
export async function deliveredInput(
	backend: Pick<AgentBackend, "readTranscript">,
	router: FauxRouter,
	session: SessionRef,
): Promise<DeliveredInput | undefined> {
	const newest = newestUserMessage(router.requests(session.sessionId).at(-1));
	if (!newest) return undefined;
	const { text: raw, images } = newest;
	const names = images.length > 0 ? await imageNames(backend, session, raw) : [];
	const attachments: Attachment[] = images.map((image, index) => {
		const name = names[index];
		return { kind: "image", mimeType: image.mimeType, data: image.data, ...(name !== undefined && { name }) };
	});
	const command = raw.startsWith(TEMPLATE_MARKER) ? commandId({ source: "template", name: TEMPLATE_NAME }) : undefined;
	const text = command === undefined ? raw : raw.slice(TEMPLATE_MARKER.length).replace(/^ /, "");
	return { text, attachments, mentions: [], ...(command !== undefined && { command }) };
}

async function imageNames(
	backend: Pick<AgentBackend, "readTranscript">,
	session: SessionRef,
	raw: string,
): Promise<(string | undefined)[]> {
	const read = await backend.readTranscript(session, { limit: 200 });
	if (read.status === "rejected") {
		throw new Error(`delivered(): the transcript cannot be read: ${read.rejection.message}`);
	}
	const item = read.page.items.find((candidate) => candidate.kind === "user_message" && candidate.text === raw);
	if (item?.kind !== "user_message") {
		throw new Error("delivered(): the transcript has no user message with the text the model received");
	}
	return item.attachments.flatMap((attachment) => (attachment.kind === "image_ref" ? [attachment.name] : []));
}
