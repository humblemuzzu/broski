/** What a `PromptInput` asks of Pi that this backend cannot give, and its parts as Pi takes them (D4, D11, D12). */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PromptInput, Rejected } from "../../../contract";
import { type PiCommandRef, parseCommandId } from "../command-ids";
import { rejected } from "../rejections";
import { PI_TRAITS } from "../traits";

export function inputProblem(input: PromptInput, session: AgentSession): Rejected | undefined {
	if (!PI_TRAITS.promptModes.includes(input.mode)) return rejected("unsupported", `Pi takes no ${input.mode} prompts`);
	if (input.mentions.some((mention) => !PI_TRAITS.mentions.includes(mention.kind))) {
		return rejected("unsupported", "Pi takes no mentions");
	}
	if (input.attachments.some((attachment) => !PI_TRAITS.attachments.includes(attachment.kind))) {
		return rejected("unsupported", "Pi takes images, not files");
	}
	const hasImages = input.attachments.length > 0;
	if (!hasImages && input.command === undefined && input.text.trim() === "") {
		return rejected("invalid_input", "the prompt is empty");
	}
	if (hasImages && session.model !== undefined && !session.model.input.includes("image")) {
		return rejected("invalid_input", `${session.model.name} does not take images`);
	}
	return input.command === undefined ? undefined : commandProblem(input, session, hasImages);
}

/** The command a validated input names. */
export function commandOf(input: PromptInput): PiCommandRef | undefined {
	return input.command === undefined ? undefined : parseCommandId(input.command);
}

export function piImages(input: PromptInput): ImageContent[] {
	return input.attachments.flatMap((attachment) =>
		attachment.kind === "image"
			? [{ type: "image" as const, data: attachment.data, mimeType: attachment.mimeType }]
			: [],
	);
}

/** By image, in order: Pi stores no names, so the transcript learns them from the `broski.prompt` entry. */
export function imageNames(input: PromptInput): (string | null)[] {
	return input.attachments.flatMap((attachment) => (attachment.kind === "image" ? [attachment.name ?? null] : []));
}

function commandProblem(input: PromptInput, session: AgentSession, hasImages: boolean): Rejected | undefined {
	const ref = commandOf(input);
	if (ref === undefined || !hasCommand(session, ref)) return rejected("not_found", `no command ${input.command}`);
	if (ref.source === "extension" && hasImages) {
		return rejected("invalid_input", "an extension command takes text only");
	}
	return undefined;
}

/**
 * A template or skill an extension command of the same name hides is not one: `prompt()` runs the extension command
 * first (pi-coding-agent `src/core/agent-session.ts:2101-2108`), and `listCommands` does not list it (`commands.ts`).
 */
function hasCommand(session: AgentSession, ref: PiCommandRef): boolean {
	const runner = session.extensionRunner;
	switch (ref.source) {
		case "extension":
			return runner.getCommand(ref.name) !== undefined;
		case "template":
			return !runner.getCommand(ref.name) && session.promptTemplates.some((template) => template.name === ref.name);
		case "skill":
			return (
				!runner.getCommand(`skill:${ref.name}`) &&
				session.resourceLoader.getSkills().skills.some((skill) => skill.name === ref.name)
			);
	}
}
