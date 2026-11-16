/**
 * What a `system` entry says, read from the raw transcript line of an entry the SDK's reader already returned
 * (it hands over only `{type, uuid, timestamp}` for them, `getSessionMessages`): the subtypes that become items (D26).
 */

import type { CompactionTrigger, NoticeLevel } from "../../../contract";
import { clip } from "../bounds";
import { isRecord } from "../json";
import { harnessText } from "../mapping/harness-text";

const MAX_FACT_CHARS = 16_384;

export interface CompactBoundary {
	readonly trigger?: CompactionTrigger;
	readonly tokensBefore?: number;
	readonly tokensAfter?: number;
}

export interface SystemFact {
	readonly subtype: "turn_duration" | "local_command" | "informational" | "away_summary" | "compact_boundary";
	readonly level: NoticeLevel;
	/** The notice's text: what the command printed, or the CLI's own message. */
	readonly text?: string;
	readonly boundary?: CompactBoundary;
}

function levelOf(value: unknown): NoticeLevel {
	return value === "warning" || value === "error" ? value : "info";
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function boundaryOf(metadata: unknown): CompactBoundary {
	if (!isRecord(metadata)) return {};
	const trigger = metadata.trigger === "manual" || metadata.trigger === "auto" ? metadata.trigger : undefined;
	const tokensBefore = count(metadata.preTokens);
	const tokensAfter = count(metadata.postTokens);
	return {
		...(trigger !== undefined && { trigger }),
		...(tokensBefore !== undefined && { tokensBefore }),
		...(tokensAfter !== undefined && { tokensAfter }),
	};
}

/** Undefined for a subtype that becomes no item and enriches none. */
export function systemFactOf(entry: unknown): SystemFact | undefined {
	if (!isRecord(entry) || typeof entry.subtype !== "string") return undefined;
	const content = typeof entry.content === "string" ? entry.content : "";
	const level = levelOf(entry.level);
	switch (entry.subtype) {
		case "turn_duration":
			return { subtype: "turn_duration", level };
		case "compact_boundary":
			return { subtype: "compact_boundary", level, boundary: boundaryOf(entry.compactMetadata) };
		case "informational":
		case "away_summary":
			return { subtype: entry.subtype, level, text: clip(content.trim(), MAX_FACT_CHARS) };
		case "local_command": {
			const printed = harnessText(content);
			if (printed.kind !== "command_output") return { subtype: "local_command", level };
			return {
				subtype: "local_command",
				level: printed.failed ? "error" : "info",
				text: clip(printed.text, MAX_FACT_CHARS),
			};
		}
		default:
			return undefined;
	}
}
