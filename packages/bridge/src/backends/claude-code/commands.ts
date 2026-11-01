/** Lane C · `CommandSummary`s from `initialize.commands`: skills marked, terminal-only commands hidden (D10). */

import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { CommandSummary } from "../../contract";

export function commandsOf(_commands: readonly SlashCommand[]): CommandSummary[] {
	return [];
}
