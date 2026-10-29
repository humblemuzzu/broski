import type { Attachment, AttachmentKind, AttachmentRef, ImageContent } from "../content";
import type { Mention, MentionKind, PromptInput } from "../input";
import { canonical, expect, fail, type LiveSession, promptInput, type Rig } from "./conformance-harness";
import { allTranscript } from "./conformance-reads";

/** A one-pixel PNG. */
const PIXEL: ImageContent = {
	kind: "image",
	mimeType: "image/png",
	data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	name: "pixel.png",
};

function attachmentOf(rig: Rig, kind: AttachmentKind): Attachment {
	return kind === "image" ? PIXEL : { kind: "file", uri: `${rig.driver.cwd}/README.md`, name: "README.md" };
}

function mentionOf(rig: Rig, kind: MentionKind): Mention {
	if (kind === "file") return { kind, path: `${rig.driver.cwd}/README.md` };
	const name = rig.driver.agentName;
	if (name === undefined) fail("agent mentions are declared but the driver names no agent");
	return { kind, name };
}

/**
 * Every declared attachment kind, mention kind and command reaches the model as sent; an undeclared
 * one is rejected `unsupported` instead of being dropped.
 */
export async function inputReachesTheModel(rig: Rig): Promise<void> {
	const { traits } = rig;
	for (const kind of traits.attachments) {
		const attachment = attachmentOf(rig, kind);
		const delivered = await deliver(rig, { attachments: [attachment], mentions: [] });
		expect(
			delivered.attachments.some((sent) => canonical(sent) === canonical(attachment)),
			`a ${kind} attachment did not reach the model`,
		);
	}
	for (const kind of traits.mentions) {
		const mention = mentionOf(rig, kind);
		const delivered = await deliver(rig, { attachments: [], mentions: [mention] });
		expect(
			delivered.mentions.some((sent) => canonical(sent) === canonical(mention)),
			`a ${kind} mention did not reach the model`,
		);
	}
	if (traits.commands) await aCommandRuns(rig);
	await undeclaredInputIsRefused(rig);
}

async function deliver(rig: Rig, extra: Pick<PromptInput, "attachments" | "mentions" | "command">) {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "reply" });
	await live.runInput(promptInput("Look at this.", "start", crypto.randomUUID(), extra));
	live.assertSettled();
	const delivered = await rig.driver.delivered(live.ref);
	if (!delivered) fail("the driver saw no input reach the model");
	return delivered;
}

/** The first listed command that starts a run reaches the model as that command. */
async function aCommandRuns(rig: Rig): Promise<void> {
	const listed = await rig.backend.listCommands({ cwd: rig.driver.cwd });
	if (listed.status === "rejected") fail(`listCommands was rejected: ${listed.rejection.message}`);
	for (const command of listed.commands) {
		const live = await rig.openNew();
		await rig.arrange(live.ref, { kind: "reply" });
		const mark = live.recorder.items.length;
		const input = promptInput("now", "start", crypto.randomUUID(), {
			attachments: [],
			mentions: [],
			command: command.id,
		});
		const result = await live.control.prompt(input);
		if (result.status === "rejected") fail(`command ${command.id} was rejected: ${result.rejection.message}`);
		if (result.disposition !== "started") continue;
		await live.runAfter(mark);
		const delivered = await rig.driver.delivered(live.ref);
		expect(delivered?.command === command.id, `command ${command.id} did not reach the model as a command`);
		return;
	}
	fail("no listed command starts a run");
}

async function undeclaredInputIsRefused(rig: Rig): Promise<void> {
	const { traits } = rig;
	const refused = async (what: string, extra: Pick<PromptInput, "attachments" | "mentions" | "command">) => {
		const live = await rig.openNew();
		const result = await live.control.prompt(promptInput("Unsupported.", "start", crypto.randomUUID(), extra));
		expect(
			result.status === "rejected" && result.rejection.code === "unsupported",
			`${what} is not declared yet accepted`,
		);
	};
	for (const kind of (["image", "file"] as const).filter((candidate) => !traits.attachments.includes(candidate))) {
		await refused(`a ${kind} attachment`, { attachments: [attachmentOf(rig, kind)], mentions: [] });
	}
	for (const kind of (["file", "agent"] as const).filter((candidate) => !traits.mentions.includes(candidate))) {
		const mention: Mention = kind === "file" ? { kind, path: "README.md" } : { kind, name: "helper" };
		await refused(`a ${kind} mention`, { attachments: [], mentions: [mention] });
	}
	if (!traits.commands) await refused("a command", { attachments: [], mentions: [], command: "/review" });
}

/** A prompt's image comes back by reference, in the live user message and in the transcript, and reads back whole. */
export async function imagesComeBackByReference(rig: Rig): Promise<void> {
	if (!rig.traits.attachments.includes("image")) return;
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "reply" });
	const clientRequestId = crypto.randomUUID();
	await live.runInput(promptInput("Look.", "start", clientRequestId, { attachments: [PIXEL], mentions: [] }));
	const message = live
		.events()
		.find((event) => event.type === "user_message" && event.clientRequestId === clientRequestId);
	if (message?.type !== "user_message") fail("the prompt has no user message");
	await readsBack(rig, live, message.attachments, "the live user message");
	const item = (await allTranscript(rig.backend, live.ref, 200)).find(
		(candidate) => candidate.kind === "user_message" && candidate.clientRequestId === clientRequestId,
	);
	if (item?.kind !== "user_message") fail("the prompt is not in the transcript");
	await readsBack(rig, live, item.attachments, "the transcript");
	const missing = await rig.backend.readAttachment(live.ref, crypto.randomUUID());
	expect(
		missing.status === "rejected" && missing.rejection.code === "not_found",
		"an unknown attachment must be not_found",
	);
}

async function readsBack(rig: Rig, live: LiveSession, attachments: readonly AttachmentRef[], where: string) {
	const ref = attachments.find((attachment) => attachment.kind === "image_ref");
	if (ref?.kind !== "image_ref") fail(`${where} does not name the image by reference`);
	const read = await rig.backend.readAttachment(live.ref, ref.id);
	if (read.status === "rejected") fail(`reading the image from ${where} was rejected: ${read.rejection.message}`);
	expect(
		read.image.data === PIXEL.data && read.image.mimeType === PIXEL.mimeType,
		`the image read from ${where} is not the one sent`,
	);
}
