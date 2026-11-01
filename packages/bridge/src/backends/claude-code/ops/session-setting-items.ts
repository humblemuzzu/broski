/** The settings `session_settings` shows, each read from where the CLI reads it and saved where the CLI saves it. */

import type { ProvenanceEntry, ResolvedSettings, Settings } from "@anthropic-ai/claude-agent-sdk";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS, type Option, type SessionSetting } from "../../../contract";
import { clip, nameOr } from "../bounds";

export const OUTPUT_STYLE = "outputStyle";
export const AUTO_MEMORY = "autoMemoryEnabled";
export const PROMPT_SUGGESTIONS = "promptSuggestionEnabled";

const TRUTHY = /^(1|true|yes|on)$/i;
const FALSY = /^(0|false|no|off)$/i;
const POLICY = "Your organization's policy sets this, so it cannot be changed here.";

export interface SettingsReading {
	readonly resolved: ResolvedSettings;
	readonly effective: Settings;
	readonly outputStyles: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export function ownerOf(reading: SettingsReading, key: string): ProvenanceEntry | undefined {
	return reading.resolved.provenance[key];
}

/** Why a change saved in `tier` may not be what the session ends up with, when a higher tier sets the key. */
function overriddenBy(entry: ProvenanceEntry | undefined, tier: "user" | "local"): string | undefined {
	if (entry === undefined || entry.source === tier) return undefined;
	if (entry.source === "managed") return POLICY;
	const higher = tier === "user" ? entry.source !== "user" : entry.source === "flag";
	return higher
		? `${entry.source} settings also set this and win over the ${tier} settings a change here saves.`
		: undefined;
}

function withNote(note: string | undefined): { note?: string } {
	return note === undefined ? {} : { note: clip(note, MAX_TEXT_CHARS) };
}

export function autoMemoryOn(reading: SettingsReading): boolean {
	const variable = reading.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
	if (variable !== undefined && TRUTHY.test(variable)) return false;
	if (variable !== undefined && FALSY.test(variable)) return true;
	return reading.effective.autoMemoryEnabled !== false;
}

/** A host asks for suggestions only when a setting says `true` (D79), so an absent key is off here, unlike in the CLI. */
export function promptSuggestionsOn(reading: SettingsReading): boolean {
	const variable = reading.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION;
	if (variable !== undefined && FALSY.test(variable)) return false;
	return reading.effective.promptSuggestionEnabled === true;
}

function suggestionsVariableNote(reading: SettingsReading): string | undefined {
	const variable = reading.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION;
	return variable !== undefined && FALSY.test(variable)
		? "The CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION environment variable turns this off, so it wins over the settings."
		: undefined;
}

function environmentNote(reading: SettingsReading, name: string): string | undefined {
	const variable = reading.env[name];
	return variable !== undefined && (TRUTHY.test(variable) || FALSY.test(variable))
		? `The ${name} environment variable sets this, so it wins over the settings.`
		: undefined;
}

function styleOptions(reading: SettingsReading, current: string): Option[] {
	const names = reading.outputStyles.includes(current) ? reading.outputStyles : [current, ...reading.outputStyles];
	return names.map((name) => ({ value: clip(name, MAX_NAME_CHARS), label: nameOr(name, "default") }));
}

export function settingItems(reading: SettingsReading): SessionSetting[] {
	const style = reading.effective.outputStyle ?? "default";
	return [
		{
			kind: "choice",
			key: OUTPUT_STYLE,
			label: "Output style",
			description: "How Claude words its answers. Saved in this project's local settings.",
			value: clip(style, MAX_NAME_CHARS),
			options: styleOptions(reading, style),
			...withNote(overriddenBy(ownerOf(reading, OUTPUT_STYLE), "local")),
		},
		{
			kind: "toggle",
			key: AUTO_MEMORY,
			label: "Auto memory",
			description: "Let Claude keep notes about this project between sessions. Saved in your user settings.",
			enabled: autoMemoryOn(reading),
			...withNote(
				environmentNote(reading, "CLAUDE_CODE_DISABLE_AUTO_MEMORY") ??
					overriddenBy(ownerOf(reading, AUTO_MEMORY), "user"),
			),
		},
		{
			kind: "toggle",
			key: PROMPT_SUGGESTIONS,
			label: "Prompt suggestions",
			description: "Suggest what to send next after each answer. Saved in your user settings.",
			enabled: promptSuggestionsOn(reading),
			...withNote(suggestionsVariableNote(reading) ?? overriddenBy(ownerOf(reading, PROMPT_SUGGESTIONS), "user")),
		},
	];
}
