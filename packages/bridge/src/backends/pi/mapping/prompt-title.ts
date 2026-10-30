import { parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../../contract";
import { clipStart } from "../bounds";

const TITLE_SCAN_CHARS = 4 * MAX_NAME_CHARS;

/**
 * Pi stores a skill command expanded into a `<skill>` block (pi-coding-agent `src/core/agent-session.ts:2212-2226`)
 * and its terminal shows it as typed (`src/modes/interactive/interactive-mode.ts:3902-3922`): `/skill:name args`.
 */
export function typedText(text: string): string {
	const skill = parseSkillBlock(text);
	const typed = skill === null ? text : `/skill:${skill.name}${skill.userMessage ? ` ${skill.userMessage}` : ""}`;
	return clipStart(typed, MAX_TEXT_CHARS);
}

export function promptTitle(text: string): string | undefined {
	const line = clipStart(clipStart(typedText(text), TITLE_SCAN_CHARS).replace(/\s+/g, " ").trim(), MAX_NAME_CHARS);
	return line === "" ? undefined : line;
}
