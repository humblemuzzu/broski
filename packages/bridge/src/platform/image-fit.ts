import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FittedImage } from "../adapter-kit/ports";
import { type ImageVariant, MAX_IMAGE_CHARS } from "../contract";
import { findBinary, IS_MACOS } from "../platform";
import { base64Length, detectImageMimeType, type ImageSize, imageDimensions } from "./image-headers";

export const MAX_IMAGE_INPUT_BYTES = 50 * 1_048_576;

const DIRECT_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const THUMB_MAX_SIDE = 512;
const THUMB_MAX_BASE64 = 384 * 1024;
const THUMB_PASSTHROUGH_BYTES = 64 * 1024;
const THUMB_PNG_MAX_BYTES = 96 * 1024;
const FULL_SIDES = [2560, 2048, 1536, 1024, 768, 512] as const;
const FULL_QUALITIES = [88, 76, 62] as const;
const THUMB_QUALITIES = [78, 62] as const;
const TOOL_TIMEOUT_MS = 10_000;

export type { FittedImage, ImageFitter } from "../adapter-kit/ports";

export async function fitImageBase64(data: string, mimeType: string, variant: ImageVariant): Promise<FittedImage> {
	const bytes = Buffer.from(data, "base64");
	if (bytes.byteLength === 0) return { ok: false, reason: "not_image", message: "empty image data" };
	return fitImageBytes(bytes, variant, mimeType);
}

export async function fitImageBytes(bytes: Uint8Array, variant: ImageVariant, hintMime?: string): Promise<FittedImage> {
	if (bytes.byteLength === 0) return { ok: false, reason: "not_image", message: "file is empty" };
	if (bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
		return { ok: false, reason: "too_large", message: "image exceeds the 50 MB read limit" };
	}
	const detected = detectImageMimeType(bytes);
	const mimeType = detected ?? (hintMime?.startsWith("image/") ? hintMime : undefined);
	if (mimeType === undefined) return { ok: false, reason: "not_image", message: "not a supported image file" };

	const direct = DIRECT_MIMES.has(mimeType);
	const dims = imageDimensions(bytes, mimeType);
	const originalBytes = bytes.byteLength;

	if (variant === "full" && direct && base64Length(originalBytes) <= MAX_IMAGE_CHARS) {
		return accepted(mimeType, Buffer.from(bytes).toString("base64"), dims, originalBytes, false);
	}
	if (
		variant === "thumbnail" &&
		direct &&
		originalBytes <= THUMB_PASSTHROUGH_BYTES &&
		dims !== undefined &&
		Math.max(dims.width, dims.height) <= THUMB_MAX_SIDE
	) {
		return accepted(mimeType, Buffer.from(bytes).toString("base64"), dims, originalBytes, false);
	}

	const converted = await transcode(bytes, mimeType, variant, dims);
	if (converted !== undefined) return converted;

	if (direct && base64Length(originalBytes) <= MAX_IMAGE_CHARS) {
		return accepted(mimeType, Buffer.from(bytes).toString("base64"), dims, originalBytes, false);
	}
	return {
		ok: false,
		reason: mimeType === "image/svg+xml" || !direct ? "unsupported" : "too_large",
		message:
			mimeType === "image/svg+xml"
				? "SVG preview is not available on this machine"
				: "image is larger than the link can carry",
	};
}

function accepted(
	mimeType: string,
	data: string,
	dims: ImageSize | undefined,
	originalBytes: number,
	resized: boolean,
): FittedImage {
	return {
		ok: true,
		mimeType,
		data,
		...(dims !== undefined && { width: dims.width, height: dims.height }),
		originalBytes,
		resized,
	};
}

async function transcode(
	bytes: Uint8Array,
	mimeType: string,
	variant: ImageVariant,
	dims: ImageSize | undefined,
): Promise<FittedImage | undefined> {
	const dir = await mkdtemp(join(tmpdir(), "broski-img-"));
	try {
		const input = join(dir, `in.${extensionFor(mimeType)}`);
		await writeFile(input, bytes);
		if (mimeType === "image/svg+xml") return await transcodeSvg(dir, input, variant, bytes.byteLength);
		const target = variant === "thumbnail" ? THUMB_MAX_BASE64 : MAX_IMAGE_CHARS;
		const longest = dims ? Math.max(dims.width, dims.height) : undefined;

		// Preserve PNG transparency when a thumbnail or converted PNG already fits comfortably.
		if (mimeType === "image/png" || mimeType === "image/webp") {
			const pngSide =
				variant === "thumbnail" ? THUMB_MAX_SIDE : longest ? Math.min(longest, FULL_SIDES[0]) : FULL_SIDES[0];
			const pngBudget = variant === "thumbnail" ? base64Length(THUMB_PNG_MAX_BYTES) : target;
			const png = await convertFile(input, join(dir, "out.png"), "png", pngSide);
			if (png && base64Length(png.byteLength) <= pngBudget) {
				return accepted("image/png", png.toString("base64"), imageDimensions(png, "image/png"), bytes.byteLength, true);
			}
		}

		const sides =
			variant === "thumbnail"
				? [THUMB_MAX_SIDE, 320]
				: longest !== undefined && longest < FULL_SIDES[0]
					? [longest, ...FULL_SIDES.filter((side) => side < longest)]
					: [...FULL_SIDES];
		const qualities = variant === "thumbnail" ? THUMB_QUALITIES : FULL_QUALITIES;
		const outPath = join(dir, "out.jpg");
		for (const side of sides) {
			for (const quality of qualities) {
				const out = await convertFile(input, outPath, "jpeg", side, quality);
				if (out && base64Length(out.byteLength) <= target) {
					return accepted(
						"image/jpeg",
						out.toString("base64"),
						imageDimensions(out, "image/jpeg"),
						bytes.byteLength,
						true,
					);
				}
			}
		}
		return undefined;
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function transcodeSvg(
	dir: string,
	input: string,
	variant: ImageVariant,
	originalBytes: number,
): Promise<FittedImage | undefined> {
	const side = variant === "thumbnail" ? THUMB_MAX_SIDE : 1600;
	if (IS_MACOS) {
		const ok = await runTool(["/usr/bin/qlmanage", "-t", "-s", String(side), "-o", dir, input]);
		if (ok) {
			const entries = await readdir(dir);
			const pngName = entries.find((entry) => entry.endsWith(".png"));
			if (pngName) {
				const png = await readFile(join(dir, pngName));
				if (base64Length(png.byteLength) <= MAX_IMAGE_CHARS) {
					return accepted("image/png", png.toString("base64"), imageDimensions(png, "image/png"), originalBytes, true);
				}
			}
		}
	}
	const out = await convertFile(input, join(dir, "svg.png"), "png", side);
	if (out && base64Length(out.byteLength) <= MAX_IMAGE_CHARS) {
		return accepted("image/png", out.toString("base64"), imageDimensions(out, "image/png"), originalBytes, true);
	}
	return undefined;
}

async function convertFile(
	input: string,
	output: string,
	format: "png" | "jpeg",
	maxSide: number,
	quality?: number,
): Promise<Buffer | undefined> {
	if (IS_MACOS) {
		const args = ["/usr/bin/sips", "-Z", String(maxSide), "-s", "format", format];
		if (format === "jpeg" && quality !== undefined) args.push("-s", "formatOptions", String(quality));
		args.push(input, "--out", output);
		if (await runTool(args)) return readOptional(output);
		return undefined;
	}
	const magick = findBinary("magick") ?? findBinary("convert");
	if (magick) {
		const args = [magick, `${input}[0]`, "-auto-orient", "-resize", `${maxSide}x${maxSide}>`];
		if (format === "jpeg" && quality !== undefined) args.push("-quality", String(quality));
		args.push(output);
		if (await runTool(args)) return readOptional(output);
	}
	const ffmpeg = findBinary("ffmpeg");
	if (ffmpeg) {
		const filter = `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease`;
		const args = [ffmpeg, "-y", "-loglevel", "error", "-i", input, "-frames:v", "1", "-vf", filter];
		if (format === "jpeg" && quality !== undefined) {
			const q = Math.max(2, Math.min(31, Math.round(((100 - quality) / 100) * 28 + 2)));
			args.push("-q:v", String(q));
		}
		args.push(output);
		if (await runTool(args)) return readOptional(output);
	}
	return undefined;
}

async function runTool(cmd: readonly string[]): Promise<boolean> {
	let proc: ReturnType<typeof Bun.spawn> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		proc = Bun.spawn([...cmd], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
		const timedOut = new Promise<number>((resolve) => {
			timer = setTimeout(() => {
				try {
					proc?.kill();
				} catch {
					// Already exited.
				}
				resolve(1);
			}, TOOL_TIMEOUT_MS);
		});
		const code = await Promise.race([proc.exited, timedOut]);
		return code === 0;
	} catch {
		return false;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function readOptional(path: string): Promise<Buffer | undefined> {
	try {
		const bytes = await readFile(path);
		return bytes.byteLength > 0 ? bytes : undefined;
	} catch {
		return undefined;
	}
}

function extensionFor(mimeType: string): string {
	switch (mimeType) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "image/heic":
			return "heic";
		case "image/avif":
			return "avif";
		case "image/tiff":
			return "tiff";
		case "image/bmp":
			return "bmp";
		case "image/x-icon":
			return "ico";
		case "image/svg+xml":
			return "svg";
		default:
			return "img";
	}
}
