/**
 * How a Pi command is named on the wire and sent back to Pi: an extension command, a prompt
 * template or a skill, each invoked as the text a terminal user would type.
 */

import { type CommandId, type CommandKind, MAX_ID_CHARS } from "../../contract";

export type PiCommandSource = "extension" | "template" | "skill";

export interface PiCommandRef {
	readonly source: PiCommandSource;
	readonly name: string;
}

const SOURCES: readonly PiCommandSource[] = ["extension", "template", "skill"];

const PREFIX: Record<PiCommandSource, string> = { extension: "ext", template: "prompt", skill: "skill" };

const KIND: Record<PiCommandSource, CommandKind> = { extension: "command", template: "prompt", skill: "skill" };

export function commandKind(source: PiCommandSource): CommandKind {
	return KIND[source];
}

/** Undefined for a name too long for a `CommandId`, or one Pi could not parse back from a prompt. */
export function commandId(ref: PiCommandRef): CommandId | undefined {
	if (ref.name === "" || /\s/.test(ref.name)) return undefined;
	const id = `${PREFIX[ref.source]}:${ref.name}`;
	return id.length <= MAX_ID_CHARS ? id : undefined;
}

export function parseCommandId(id: CommandId): PiCommandRef | undefined {
	const colon = id.indexOf(":");
	const prefix = id.slice(0, colon);
	const name = id.slice(colon + 1);
	const source = SOURCES.find((candidate) => PREFIX[candidate] === prefix);
	if (colon < 0 || source === undefined || name === "" || /\s/.test(name)) return undefined;
	return { source, name };
}

/**
 * The prompt text Pi dispatches as this command: `/name` for an extension command or a template
 * (pi-coding-agent `src/core/agent-session.ts:2101-2108`, `src/core/prompt-templates.ts:309-322`),
 * `/skill:name` for a skill (`src/core/agent-session.ts:2211-2225`).
 */
export function commandText(ref: PiCommandRef, args: string): string {
	const head = ref.source === "skill" ? `/skill:${ref.name}` : `/${ref.name}`;
	return args === "" ? head : `${head} ${args}`;
}
