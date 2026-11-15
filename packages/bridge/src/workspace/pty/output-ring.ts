/**
 * The newest `capacity` bytes a terminal wrote, each at its offset since the terminal opened, so a client that
 * comes back with the offset it reached is sent only what it missed.
 */
export class OutputRing {
	private readonly chunks: Uint8Array[] = [];
	private held = 0;
	private total = 0;

	constructor(private readonly capacity: number) {}

	/** The offset after the newest byte: where the next output starts. */
	get end(): number {
		return this.total;
	}

	/** Appends `data` and answers the offset of its first byte. */
	append(data: Uint8Array): number {
		const seq = this.total;
		this.chunks.push(data);
		this.held += data.length;
		this.total += data.length;
		while (this.held > this.capacity) {
			const oldest = this.chunks[0];
			if (!oldest) break;
			const excess = this.held - this.capacity;
			if (oldest.length <= excess) {
				this.chunks.shift();
				this.held -= oldest.length;
			} else {
				this.chunks[0] = oldest.subarray(excess);
				this.held -= excess;
			}
		}
		return seq;
	}

	/**
	 * What the ring holds from `since` on, when it reaches back that far and `since` is not past the end;
	 * otherwise everything it holds. `seq` is where the answer starts.
	 */
	since(since: number | undefined): { seq: number; data: Uint8Array } {
		const start = this.total - this.held;
		const from = since !== undefined && since >= start && since <= this.total ? since : start;
		const data = new Uint8Array(this.total - from);
		let skip = from - start;
		let at = 0;
		for (const chunk of this.chunks) {
			const part = skip >= chunk.length ? undefined : chunk.subarray(skip);
			skip = Math.max(0, skip - chunk.length);
			if (!part) continue;
			data.set(part, at);
			at += part.length;
		}
		return { seq: from, data };
	}
}
