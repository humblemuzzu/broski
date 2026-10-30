import { MAX_TEXT_CHARS } from "../../../contract";
import { clipEnd } from "../bounds";

export type BlockType = "text" | "thinking";

/**
 * An open block and what its deltas have said so far, kept as pieces and joined only when they pass twice the bound:
 * joining on every delta would copy the whole text each time. `text()` is the newest `MAX_TEXT_CHARS`, as the
 * snapshot keeps it.
 */
export class OpenBlock {
	private pieces: string[] = [];
	private length = 0;
	deltas = false;

	constructor(readonly kind: BlockType) {}

	add(delta: string): void {
		this.pieces.push(delta);
		this.length += delta.length;
		this.deltas = true;
		if (this.length > 2 * MAX_TEXT_CHARS) this.compact();
	}

	text(): string {
		this.compact();
		return this.pieces[0] ?? "";
	}

	private compact(): void {
		if (this.pieces.length <= 1 && this.length <= MAX_TEXT_CHARS) return;
		const text = clipEnd(this.pieces.join(""), MAX_TEXT_CHARS);
		this.pieces = [text];
		this.length = text.length;
	}
}
