/** A real PNG of one colour, made here so a test knows exactly what the model is shown and what must read back. */

import { deflateSync } from "node:zlib";
import type { ImageContent } from "../../../contract";

function chunk(type: string, data: Uint8Array): Buffer {
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(Bun.hash.crc32(body) >>> 0);
	return Buffer.concat([length, body, crc]);
}

/** An 8-bit RGB image of `size`×`size` pixels, every one `rgb`. */
export function solidPng(rgb: readonly [number, number, number], size = 32): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
	const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", pixels),
		chunk("IEND", new Uint8Array()),
	]);
}

export function pngAttachment(rgb: readonly [number, number, number], name: string): ImageContent {
	return { kind: "image", mimeType: "image/png", data: solidPng(rgb).toString("base64"), name };
}
