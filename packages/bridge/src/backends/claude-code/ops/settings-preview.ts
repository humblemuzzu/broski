/** A settings value as one line for a list row: enough to read, with nothing secret in it. */

import { clip } from "../bounds";
import { isRecord } from "../json";

const PREVIEW_CHARS = 300;
const SECRET_KEY = /token|secret|password|passphrase|authorization|api[_-]?key|credential/i;
const NAMES_ONLY = new Set(["env", "mcpServers", "managedMcpServers", "hooks", "headers", "sshConfigs"]);

function names(value: Record<string, unknown>): string {
	const keys = Object.keys(value);
	if (keys.length === 0) return "none";
	const shown = keys.slice(0, 12).join(", ");
	return `${keys.length}: ${shown}${keys.length > 12 ? ", …" : ""}`;
}

function masked(value: unknown, key: string): unknown {
	if (SECRET_KEY.test(key)) return "••••";
	if (Array.isArray(value)) return value.map((item) => masked(item, key));
	if (!isRecord(value)) return value;
	const copy: Record<string, unknown> = {};
	for (const [name, item] of Object.entries(value)) {
		Object.defineProperty(copy, name, {
			value: masked(item, name),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return copy;
}

function clipped(text: string): string {
	return text.length > PREVIEW_CHARS ? `${clip(text, PREVIEW_CHARS - 1)}…` : text;
}

export function previewOf(key: string, value: unknown): string {
	if (NAMES_ONLY.has(key) && isRecord(value)) return names(value);
	if (typeof value === "string") return clipped(SECRET_KEY.test(key) ? "••••" : value);
	if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
	return clipped(JSON.stringify(masked(value, key)) ?? "");
}
