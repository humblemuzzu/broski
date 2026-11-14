/** The `toolUseResult` of an entry the SDK returned, read at its recorded byte span and bounded (D26). */

import { open } from "node:fs/promises";
import type { JsonValue } from "../../../contract";
import { boundedJson, isRecord } from "../json";
import type { Span } from "./raw-scan";

/** What one page may read of the file for tool results; entries past it show without their structured result. */
const PAGE_BUDGET_BYTES = 32 * 1_048_576;

export class ToolUseResults {
	private remaining = PAGE_BUDGET_BYTES;

	constructor(private readonly path: string) {}

	/**
	 * The entry's `toolUseResult` through `boundedJson`, or undefined when the line at `span` is not that entry's
	 * (the file changed since the scan), is not JSON, or the page's budget is spent. Never throws.
	 */
	async read(uuid: string, span: Span): Promise<JsonValue | undefined> {
		if (span.length > this.remaining) return undefined;
		this.remaining -= span.length;
		try {
			const handle = await open(this.path, "r");
			try {
				const buffer = Buffer.alloc(span.length);
				const { bytesRead } = await handle.read(buffer, 0, span.length, span.offset);
				const entry: unknown = JSON.parse(buffer.toString("utf8", 0, bytesRead));
				if (!isRecord(entry) || entry.uuid !== uuid || entry.toolUseResult === undefined) return undefined;
				return boundedJson(entry.toolUseResult);
			} finally {
				await handle.close();
			}
		} catch {
			return undefined;
		}
	}
}
