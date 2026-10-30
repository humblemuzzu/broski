/**
 * A session file copied as it is now: the bytes up to the last complete line, whatever a writer appends meanwhile.
 * A file Pi is appending to is read at the size it had when the copy began; a line still being written is left out.
 */

import { open } from "node:fs/promises";
import { openRegularFile } from "../store/open-file";

const BLOCK_BYTES = 1 << 20;

/** Bytes copied to `to`, or undefined when `from` is no longer a regular file. */
export async function copyCompleteLines(from: string, to: string): Promise<number | undefined> {
	const source = await openRegularFile(from);
	if (source === undefined) return undefined;
	const target = await open(to, "wx");
	try {
		const size = (await source.stat()).size;
		const block = Buffer.allocUnsafe(Math.min(BLOCK_BYTES, Math.max(1, size)));
		let copied = 0;
		let complete = 0;
		while (copied < size) {
			const { bytesRead } = await source.read(block, 0, Math.min(block.length, size - copied), copied);
			if (bytesRead === 0) break;
			await target.write(block, 0, bytesRead);
			const lastBreak = block.subarray(0, bytesRead).lastIndexOf(0x0a);
			if (lastBreak !== -1) complete = copied + lastBreak + 1;
			copied += bytesRead;
		}
		const kept = complete === 0 ? copied : complete;
		if (kept < copied) await target.truncate(kept);
		return kept;
	} finally {
		await source.close();
		await target.close();
	}
}
