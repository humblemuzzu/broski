/**
 * Strict JSONL framing as `pi --mode rpc` writes it (pi-coding-agent 1.5.2 `docs/rpc.md:50-56`, `dist/modes/rpc/jsonl.js`):
 * records split on LF alone, a CR before it dropped, never on U+2028/U+2029, which are valid inside JSON strings. LF is
 * a single byte no UTF-8 sequence contains, so lines are cut as bytes and decoded whole. A record longer than the bound
 * is skipped, never buffered, and reported by its size.
 */

/** The largest record kept. A tool call's arguments or an image in a message fit; a run's `agent_end`, which repeats every message, may not, and is not read. */
export const MAX_RECORD_BYTES = 32 * 1024 * 1024;

export type JsonlItem =
	| { readonly kind: "line"; readonly text: string }
	| { readonly kind: "oversized"; readonly bytes: number };

const LF = 0x0a;
const CR = 0x0d;

export class JsonlSplitter {
	private parts: Uint8Array[] = [];
	private bytes = 0;
	private skipping = false;
	private readonly decoder = new TextDecoder("utf-8");

	constructor(private readonly maxBytes = MAX_RECORD_BYTES) {}

	push(chunk: Uint8Array): JsonlItem[] {
		const items: JsonlItem[] = [];
		let start = 0;
		for (let newline = chunk.indexOf(LF); newline !== -1; newline = chunk.indexOf(LF, start)) {
			this.take(chunk.subarray(start, newline));
			items.push(this.finish());
			start = newline + 1;
		}
		this.take(chunk.subarray(start));
		return items;
	}

	/** The stream ended: a last record without its LF is still one, as Pi's own reader takes it. */
	end(): JsonlItem[] {
		return this.bytes === 0 && !this.skipping ? [] : [this.finish()];
	}

	private take(part: Uint8Array): void {
		if (part.length === 0) return;
		this.bytes += part.length;
		if (this.skipping) return;
		if (this.bytes > this.maxBytes) {
			this.skipping = true;
			this.parts = [];
			return;
		}
		this.parts.push(part);
	}

	private finish(): JsonlItem {
		const bytes = this.bytes;
		const skipped = this.skipping;
		const parts = this.parts;
		this.parts = [];
		this.bytes = 0;
		this.skipping = false;
		if (skipped) return { kind: "oversized", bytes };
		const line = parts.length === 1 && parts[0] !== undefined ? parts[0] : concat(parts, bytes);
		const end = line.at(-1) === CR ? line.length - 1 : line.length;
		return { kind: "line", text: this.decoder.decode(line.subarray(0, end)) };
	}
}

function concat(parts: readonly Uint8Array[], bytes: number): Uint8Array {
	const whole = new Uint8Array(bytes);
	let at = 0;
	for (const part of parts) {
		whole.set(part, at);
		at += part.length;
	}
	return whole;
}
