/**
 * Recognises the `/v1/messages` requests the CLI sends besides the main conversation, so they never consume
 * the main script. Markers come from real CLI traffic (`scripts/cc-spike/probe-side-requests.ts`):
 * - `subagent`: the billing header block of the system prompt carries `cc_is_subagent=true` (Agent tool);
 * - `compact`: the last user message asks for an `<analysis>` and `<summary>` reply (`/compact`, auto-compact);
 * - `title`: the system prompt starts "You are naming a coding session" (only sent with nonessential traffic on).
 */

import type { ScriptedTurn } from "./scripted-anthropic-sse";

export type SideKind = "subagent" | "compact" | "title";

const COMPACT_MARKERS = ["<summary></summary> tags", "an <analysis> block followed by a <summary> block"];

function texts(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (!Array.isArray(value)) return [];
	return value.flatMap((block) =>
		block !== null && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
			? [(block as { text: string }).text]
			: [],
	);
}

function field(body: unknown, key: string): unknown {
	return body !== null && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

function lastUserText(body: unknown): string {
	const messages = field(body, "messages");
	if (!Array.isArray(messages)) return "";
	const last = messages.at(-1) as { role?: string; content?: unknown } | undefined;
	return last?.role === "user" ? texts(last.content).join("\n") : "";
}

export function sideKind(body: unknown): SideKind | null {
	const system = texts(field(body, "system")).join("\n");
	if (system.includes("cc_is_subagent=true")) return "subagent";
	if (system.includes("You are naming a coding session")) return "title";
	const last = lastUserText(body);
	if (COMPACT_MARKERS.some((marker) => last.includes(marker))) return "compact";
	return null;
}

/** The default answer for a side request no test route claimed. */
export function sideTurn(kind: SideKind): ScriptedTurn {
	if (kind === "compact") return { text: ["<analysis>scripted</analysis>\n<summary>Scripted summary.</summary>"] };
	if (kind === "title") return { text: ["Scripted session"] };
	return { text: ["Subagent done."] };
}
