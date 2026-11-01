/** Lane G · bytes to complete JSONL lines; a partial last line waits for the next read. */

export class JsonlLines {
	push(_chunk: Uint8Array): string[] {
		return [];
	}
}
