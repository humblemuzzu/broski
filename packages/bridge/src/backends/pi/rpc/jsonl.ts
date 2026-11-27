import type { JsonlItem } from "../../../adapter-kit/jsonl";

/** Pi's `agent_end` repeats every message of the run (`docs/json.md`), which the adapter reads from their own events. */
export function isRunDump(item: Extract<JsonlItem, { kind: "oversized" }>): boolean {
	return item.head !== undefined && /^\s*\{\s*"type"\s*:\s*"agent_end"/.test(item.head);
}
