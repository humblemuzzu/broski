/** Bytes to complete JSONL lines; the partial last line waits for the next read, and a line past the bound is dropped. */

export const MAX_LINE_BYTES = 4 * 1_048_576;

const NEWLINE = 0x0a;
const DECODER = new TextDecoder("utf-8", { fatal: false });

export class JsonlLines {
	private parts: Uint8Array[] = [];
	private pendingBytes = 0;
	private skipping = false;
	private droppedLines = 0;

	/** Lines that were longer than `MAX_LINE_BYTES` and so never reached a caller. */
	get dropped(): number {
		return this.droppedLines;
	}

	push(chunk: Uint8Array): string[] {
		const lines: string[] = [];
		let start = 0;
		for (let end = chunk.indexOf(NEWLINE, start); end !== -1; end = chunk.indexOf(NEWLINE, start)) {
			const line = this.finish(chunk.subarray(start, end));
			if (line !== undefined) lines.push(line);
			start = end + 1;
		}
		this.keep(chunk.subarray(start));
		return lines;
	}

	reset(): void {
		this.parts = [];
		this.pendingBytes = 0;
		this.skipping = false;
	}

	private finish(last: Uint8Array): string | undefined {
		if (this.skipping) {
			this.skipping = false;
			this.droppedLines += 1;
			return undefined;
		}
		if (this.pendingBytes + last.length > MAX_LINE_BYTES) {
			this.parts = [];
			this.pendingBytes = 0;
			this.droppedLines += 1;
			return undefined;
		}
		const whole = this.parts.length === 0 ? last : concat([...this.parts, last], this.pendingBytes + last.length);
		this.parts = [];
		this.pendingBytes = 0;
		const text = DECODER.decode(whole);
		return text.endsWith("\r") ? text.slice(0, -1) : text;
	}

	private keep(rest: Uint8Array): void {
		if (rest.length === 0 || this.skipping) return;
		if (this.pendingBytes + rest.length > MAX_LINE_BYTES) {
			this.parts = [];
			this.pendingBytes = 0;
			this.skipping = true;
			return;
		}
		this.parts.push(new Uint8Array(rest));
		this.pendingBytes += rest.length;
	}
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
