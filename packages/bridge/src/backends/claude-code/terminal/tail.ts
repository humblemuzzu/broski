/** Lane G · positional reads of a transcript as it grows, whole lines only. */

export class TranscriptTail {
	constructor(readonly path: string) {}

	async read(): Promise<readonly string[]> {
		return [];
	}
}
