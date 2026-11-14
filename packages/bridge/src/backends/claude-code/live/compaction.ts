/** `compact` is a `/compact <instructions>` prompt (Q13). */

import { type ActionResult, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import type { PromptDesk } from "./prompt-desk";

export function startCompaction(prompts: PromptDesk, instructions: string | undefined): Promise<ActionResult> {
	const detail = clip(instructions?.trim() ?? "", MAX_TEXT_CHARS);
	return prompts.compaction(detail === "" ? "/compact" : `/compact ${detail}`);
}
