/**
 * Strict JSONL framing as `pi --mode rpc` writes it (pi-coding-agent 1.5.2 `docs/rpc.md:50-56`, `dist/modes/rpc/jsonl.js`):
 * records split on LF alone, a CR before it dropped, never on U+2028/U+2029, which are valid inside JSON strings. LF is
 * a single byte no UTF-8 sequence contains, so lines are cut as bytes and decoded whole. A record longer than the bound
 * is skipped, never buffered, and reported by its size and its first bytes.
 */

/** The largest record kept. A tool call's arguments or an image in a message fit; a run's `agent_end`, which repeats every message, may not, and is not read. */
export const MAX_RECORD_BYTES = 64 * 1024 * 1024;

/** Enough of a skipped record to read its `type`, which Pi writes first. */
const HEAD_BYTES = 128;

export type JsonlItem =
	| { readonly kind: "line"; readonly text: string }
	| { readonly kind: "oversized"; readonly bytes: number; readonly head?: string };

/**
 * Pi's `agent_end` repeats every message of the run (`docs/json.md`), which the adapter reads from each message's own
 * events and never from it: one past the bound loses nothing.
 */
export function isRunDump(item: Extract<JsonlItem, { kind: "oversized" }>): boolean {
	return item.head !== undefined && /^\s*\{\s*"type"\s*:\s*"agent_end"/.test(item.head);
}

const LF = 0x0a;
const CR = 0x0d;

export class JsonlSplitter {
	private parts: Uint8Array[] = [];
	private bytes = 0;
	private skipping = false;
	private head = "";
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
			this.head = this.decoder.decode(firstBytes([...this.parts, part], HEAD_BYTES));
			this.parts = [];
			return;
		}
		this.parts.push(part);
	}

	private finish(): JsonlItem {
		const bytes = this.bytes;
		const skipped = this.skipping;
		const parts = this.parts;
		const head = this.head;
		this.parts = [];
		this.bytes = 0;
		this.skipping = false;
		this.head = "";
		if (skipped) return { kind: "oversized", bytes, head };
		const line = parts.length === 1 && parts[0] !== undefined ? parts[0] : concat(parts, bytes);
		const end = line.at(-1) === CR ? line.length - 1 : line.length;
		return { kind: "line", text: this.decoder.decode(line.subarray(0, end)) };
	}
}

function firstBytes(parts: readonly Uint8Array[], max: number): Uint8Array {
	const head = new Uint8Array(max);
	let at = 0;
	for (const part of parts) {
		if (at === max) break;
		const piece = part.subarray(0, max - at);
		head.set(piece, at);
		at += piece.length;
	}
	return head.subarray(0, at);
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
