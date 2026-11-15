/** What a `PromptInput` asks of Pi that this backend cannot give, and its parts as Pi takes them. */

import type { PromptInput, Rejected } from "../../../contract";
import { type PiCommandRef, parseCommandId } from "../command-ids";
import { HOST_COMMAND } from "../host/protocol";
import type { ImageContent } from "../messages";
import { rejected } from "../rejections";
import type { PiModel } from "../rpc/replies";
import { PI_TRAITS } from "../traits";

/** `model` is the session's now; Pi refuses an image a model cannot read, so it is refused here first. */
export function inputProblem(input: PromptInput, model: PiModel | undefined): Rejected | undefined {
	if (!PI_TRAITS.promptModes.includes(input.mode)) return rejected("unsupported", `Pi takes no ${input.mode} prompts`);
	if (input.attachments.some((attachment) => !PI_TRAITS.attachments.includes(attachment.kind))) {
		return rejected("unsupported", "Pi takes images, not files");
	}
	const hasImages = input.attachments.length > 0;
	if (!hasImages && input.command === undefined && input.text.trim() === "") {
		return rejected("invalid_input", "the prompt is empty");
	}
	if (hasImages && model?.input !== undefined && !model.input.includes("image")) {
		return rejected("invalid_input", `${model.name ?? model.id} does not take images`);
	}
	if (input.command === undefined && isHostCommand(input.text)) {
		return rejected("invalid_input", `/${HOST_COMMAND} is the bridge's own command`);
	}
	const ref = commandOf(input);
	if (input.command !== undefined && ref === undefined) return rejected("not_found", `no command ${input.command}`);
	if (ref?.source === "extension" && hasImages)
		return rejected("invalid_input", "an extension command takes text only");
	return undefined;
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

/** By image, in order: Pi stores no names, so the transcript learns them from the `broski.prompt` record. */
export function imageNames(input: PromptInput): (string | null)[] {
	return input.attachments.flatMap((attachment) => (attachment.kind === "image" ? [attachment.name ?? null] : []));
}

/** Pi runs a prompt that begins with an extension command's name as that command (`docs/rpc-commands.md:31`). */
function isHostCommand(text: string): boolean {
	const name = /^\/(\S+)/.exec(text)?.[1];
	return name === HOST_COMMAND;
}
