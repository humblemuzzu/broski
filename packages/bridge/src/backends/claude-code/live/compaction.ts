/** `compact`: `/compact <instructions>` sent as a prompt; the frames show it (Q13). */

import type { ActionResult } from "../../../contract";
import type { PromptDesk } from "./prompt-desk";

export function startCompaction(prompts: PromptDesk, instructions: string | undefined): Promise<ActionResult> {
	const detail = instructions?.trim() ?? "";
	return prompts.action(detail === "" ? "/compact" : `/compact ${detail}`);
}
