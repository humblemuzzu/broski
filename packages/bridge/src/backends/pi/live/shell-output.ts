/**
 * A `!` command's output as its card shows it while it runs: the newest of it as Pi's own `bash` tool keeps it
 * (`truncateTail`: the last `DEFAULT_MAX_LINES` lines or `DEFAULT_MAX_BYTES` bytes), sent whole (`output_replaced`)
 * at most every `FLUSH_MS`, as the agent's own calls are (`mapping/tool-items.ts`, `toolOutputOf`). However much the
 * command prints, the link carries one bounded tail a few times a second. The whole output is the session's:
 * `executeBash` records it, and the finished card is built from that record.
 */

import { DEFAULT_MAX_BYTES, truncateTail } from "@earendil-works/pi-coding-agent";
import { withoutTerminalEscapes } from "../terminal-text";

const FLUSH_MS = 250;

/** Twice what a tail shows, so a tail of whole lines can always be cut from what is kept. */
const KEPT_CHARS = 2 * DEFAULT_MAX_BYTES;

export class ShellOutput {
	private kept = "";
	private dirty = false;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly send: (tail: string) => void) {}

	add(chunk: string): void {
		this.kept += chunk;
		if (this.kept.length > 2 * KEPT_CHARS) this.kept = linesFrom(this.kept, this.kept.length - KEPT_CHARS);
		this.dirty = true;
		this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
	}

	flush(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		if (!this.dirty) return;
		this.dirty = false;
		this.send(truncateTail(withoutTerminalEscapes(this.kept)).content);
	}
}

/** The text from the first line that starts at or after `from`; from `from` itself when no line does. */
function linesFrom(text: string, from: number): string {
	const lineBreak = text.indexOf("\n", from);
	return lineBreak === -1 ? text.slice(from) : text.slice(lineBreak + 1);
}
