import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import type { FsImageResult, ImageVariant } from "../../contract";
import { fitImageBytes, MAX_IMAGE_INPUT_BYTES } from "../../platform/image-fit";
import { rejected } from "../results";
import { fileSystemRejection } from "./errors";

export async function readImageFile(path: string, variant: ImageVariant = "full"): Promise<FsImageResult> {
	let handle: FileHandle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		return fileSystemRejection(error, path);
	}
	let bytes: Uint8Array;
	let size: number;
	try {
		const stats = await handle.stat();
		if (stats.isDirectory()) return rejected("invalid_input", `${path} is a directory`);
		if (!stats.isFile()) return rejected("invalid_input", `${path} is not a regular file`);
		size = stats.size;
		if (size === 0) return rejected("invalid_input", `${path} is empty`);
		if (size > MAX_IMAGE_INPUT_BYTES) {
			return rejected("unsupported", `${path} is larger than 50 MB`);
		}
		bytes = await readAll(handle, size);
	} catch (error) {
		return fileSystemRejection(error, path);
	} finally {
		await handle.close();
	}

	const fitted = await fitImageBytes(bytes, variant);
	if (!fitted.ok) {
		const code = fitted.reason === "not_image" ? "invalid_input" : "unsupported";
		return rejected(code, fitted.message);
	}
	return {
		status: "accepted",
		path,
		mimeType: fitted.mimeType,
		data: fitted.data,
		size,
		...(fitted.width !== undefined && { width: fitted.width }),
		...(fitted.height !== undefined && { height: fitted.height }),
		resized: fitted.resized,
	};
}

async function readAll(handle: FileHandle, size: number): Promise<Uint8Array> {
	const buffer = new Uint8Array(size);
	let filled = 0;
	while (filled < size) {
		const { bytesRead } = await handle.read(buffer, filled, size - filled, filled);
		if (bytesRead === 0) break;
		filled += bytesRead;
	}
	return buffer.subarray(0, filled);
}
