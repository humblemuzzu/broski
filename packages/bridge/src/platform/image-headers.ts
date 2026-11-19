const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

export interface ImageSize {
	readonly width: number;
	readonly height: number;
}

export function detectImageMimeType(bytes: Uint8Array): string | undefined {
	if (bytes.length < 4) return undefined;
	if (matches(bytes, 0, PNG_SIG)) return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
	if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
	if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
	if (
		(bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
		(bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
	) {
		return "image/tiff";
	}
	if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
	if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
		const brand = ascii(bytes, 8, 12).toLowerCase();
		if (HEIC_BRANDS.has(brand)) return "image/heic";
		if (AVIF_BRANDS.has(brand)) return "image/avif";
	}
	if (looksLikeSvg(bytes)) return "image/svg+xml";
	return undefined;
}

export function imageDimensions(bytes: Uint8Array, mimeType: string): ImageSize | undefined {
	switch (mimeType) {
		case "image/png":
			return pngDimensions(bytes);
		case "image/gif":
			return gifDimensions(bytes);
		case "image/bmp":
			return bmpDimensions(bytes);
		case "image/webp":
			return webpDimensions(bytes);
		case "image/jpeg":
			return jpegDimensions(bytes);
		default:
			return undefined;
	}
}

export function base64Length(byteLength: number): number {
	return Math.ceil(byteLength / 3) * 4;
}

function pngDimensions(bytes: Uint8Array): ImageSize | undefined {
	if (bytes.length < 24 || ascii(bytes, 12, 16) !== "IHDR") return undefined;
	const width = readU32BE(bytes, 16);
	const height = readU32BE(bytes, 20);
	return validSize(width, height);
}

function gifDimensions(bytes: Uint8Array): ImageSize | undefined {
	if (bytes.length < 10) return undefined;
	return validSize(readU16LE(bytes, 6), readU16LE(bytes, 8));
}

function bmpDimensions(bytes: Uint8Array): ImageSize | undefined {
	if (bytes.length < 26) return undefined;
	const width = readI32LE(bytes, 18);
	const height = Math.abs(readI32LE(bytes, 22));
	return validSize(width, height);
}

function webpDimensions(bytes: Uint8Array): ImageSize | undefined {
	if (bytes.length < 30) return undefined;
	const chunk = ascii(bytes, 12, 16);
	if (chunk === "VP8X") {
		const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
		const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
		return validSize(width, height);
	}
	if (chunk === "VP8L" && bytes[20] === 0x2f) {
		const bits = readU32LE(bytes, 21);
		return validSize((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
	}
	if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
		return validSize(readU16LE(bytes, 26) & 0x3fff, readU16LE(bytes, 28) & 0x3fff);
	}
	return undefined;
}

function jpegDimensions(bytes: Uint8Array): ImageSize | undefined {
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return undefined;
		while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
		if (offset >= bytes.length) return undefined;
		const marker = bytes[offset]!;
		offset += 1;
		if (marker === 0xd9 || marker === 0xda) return undefined;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
		if (offset + 2 > bytes.length) return undefined;
		const length = readU16BE(bytes, offset);
		if (length < 2 || offset + length > bytes.length) return undefined;
		if (isSofMarker(marker) && length >= 7) {
			return validSize(readU16BE(bytes, offset + 5), readU16BE(bytes, offset + 3));
		}
		offset += length;
	}
	return undefined;
}

function isSofMarker(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function looksLikeSvg(bytes: Uint8Array): boolean {
	const sample = bytes.subarray(0, Math.min(bytes.length, 512));
	if (sample.includes(0)) return false;
	const text = new TextDecoder("utf-8", { fatal: false }).decode(sample).trimStart().toLowerCase();
	if (text.startsWith("<svg")) return true;
	return text.startsWith("<?xml") && text.includes("<svg");
}

function validSize(width: number, height: number): ImageSize | undefined {
	return width > 0 && height > 0 && width <= 65_535 && height <= 65_535 ? { width, height } : undefined;
}

function matches(bytes: Uint8Array, start: number, sig: readonly number[]): boolean {
	if (bytes.length < start + sig.length) return false;
	for (let i = 0; i < sig.length; i += 1) if (bytes[start + i] !== sig[i]) return false;
	return true;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	let out = "";
	for (let i = start; i < end && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
	return out;
}

function readU16BE(b: Uint8Array, o: number): number {
	return (b[o]! << 8) | b[o + 1]!;
}

function readU16LE(b: Uint8Array, o: number): number {
	return b[o]! | (b[o + 1]! << 8);
}

function readU32BE(b: Uint8Array, o: number): number {
	return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function readU32LE(b: Uint8Array, o: number): number {
	return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

function readI32LE(b: Uint8Array, o: number): number {
	return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24);
}
