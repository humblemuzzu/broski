import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../../contract";
import { clipStart } from "../bounds";

const TITLE_SCAN_CHARS = 4 * MAX_NAME_CHARS;

/** Pi's `parseSkillBlock` (pi-coding-agent 1.5.2 `dist/core/agent-session.js:63-73`). */
const SKILL_BLOCK = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * Pi stores a skill command expanded into a `<skill>` block (`dist/core/agent-session.js:1811-1835`) and its terminal
 * shows it as typed: `/skill:name args`.
 */
export function typedText(text: string): string {
	const skill = SKILL_BLOCK.exec(text);
	const args = skill?.[4]?.trim();
	const typed = skill === null ? text : `/skill:${skill[1]}${args ? ` ${args}` : ""}`;
	return clipStart(typed, MAX_TEXT_CHARS);
}

export function promptTitle(text: string): string | undefined {
	const line = clipStart(clipStart(typedText(text), TITLE_SCAN_CHARS).replace(/\s+/g, " ").trim(), MAX_NAME_CHARS);
	return line === "" ? undefined : line;
}
