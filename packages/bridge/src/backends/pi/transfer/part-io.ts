/** A file moving in parts of `MAX_TRANSFER_PART_BYTES`, each as base64. */

import { open } from "node:fs/promises";
import { MAX_TRANSFER_PART_BYTES } from "../../../contract";

export interface ReadPart {
	readonly data: string;
	readonly done: boolean;
}

/** The part of the `size`-byte file at `path` that starts at `offset`; undefined when the file is shorter than it was. */
export async function readPart(path: string, offset: number, size: number): Promise<ReadPart | undefined> {
	const length = Math.min(MAX_TRANSFER_PART_BYTES, size - offset);
	const handle = await open(path, "r");
	try {
		const bytes = Buffer.allocUnsafe(length);
		let filled = 0;
		while (filled < length) {
			const { bytesRead } = await handle.read(bytes, filled, length - filled, offset + filled);
			if (bytesRead === 0) return undefined;
			filled += bytesRead;
		}
		return { data: bytes.toString("base64"), done: offset + length >= size };
	} finally {
		await handle.close();
	}
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The bytes of canonical base64, or undefined for text that is not (`Buffer.from` would skip what it does not know). */
export function decodeBase64(text: string): Buffer | undefined {
	return BASE64.test(text) ? Buffer.from(text, "base64") : undefined;
}
