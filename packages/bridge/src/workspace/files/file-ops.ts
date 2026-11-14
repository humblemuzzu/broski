/**
 * Reading the file system for a person: list a directory, read a text file, read a file's bytes. Every
 * path goes through the given directory policy (`getSecurePath` in production) before it is opened.
 */

import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { resolve } from "node:path";

type GetSecurePath = (requestedPath: string) => Promise<string | null>;

function moduleLogError(message: string, ...args: unknown[]): void {
	if (args.length > 0) {
		console.error(message, ...args);
	} else {
		console.error(message);
	}
}

export async function listFilesDirectly(
	filePath: string,
	getSecurePath: GetSecurePath,
): Promise<
	Array<{
		name: string;
		type: "file" | "directory";
		path: string;
		absolute: string;
	}>
> {
	const securePath = await getSecurePath(filePath);
	if (!securePath) {
		moduleLogError(`[listFilesDirectly] Access denied: ${filePath}`);
		return [];
	}

	try {
		const entries = await readdir(securePath, { withFileTypes: true });
		const items: Array<{
			name: string;
			type: "file" | "directory";
			path: string;
			absolute: string;
		}> = [];

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;

			const absolute = resolve(securePath, entry.name);
			items.push({
				name: entry.name,
				type: entry.isDirectory() ? "directory" : "file",
				path: absolute,
				absolute,
			});
		}

		// Sort: directories first, then files, alphabetically
		items.sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === "directory" ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});

		return items;
	} catch (error) {
		moduleLogError(`[listFilesDirectly] Error listing ${securePath}:`, error);
		return [];
	}
}

export async function readFileDirectly(
	filePath: string,
	getSecurePath: GetSecurePath,
): Promise<{
	type: "text" | "binary";
	content: string;
	mime: string;
	mimeType: string;
	encoding?: "base64";
}> {
	const securePath = await getSecurePath(filePath);
	if (!securePath) {
		moduleLogError(`[readFileDirectly] Access denied: ${filePath}`);
		return {
			type: "text",
			content: "",
			mime: "text/plain",
			mimeType: "text/plain",
		};
	}

	try {
		// Mitigate symlink-based TOCTOU by refusing to follow symlinks at open-time.
		// O_NOFOLLOW not available on Windows — symlink defense disabled there (acceptable trade-off for dev tool)
		const noFollow = Number((fsConstants as any).O_NOFOLLOW ?? 0) || 0;
		if (!noFollow) {
			// Best-effort symlink refusal on platforms without O_NOFOLLOW.
			const lst = await lstat(securePath).catch(() => null);
			if (lst?.isSymbolicLink()) {
				return {
					type: "text",
					content: "",
					mime: "text/plain",
					mimeType: "text/plain",
				};
			}
		}
		const flags = fsConstants.O_RDONLY | noFollow;
		const fh = await open(securePath, flags).catch(async (err) => {
			// Fallback for platforms that don't support O_NOFOLLOW.
			const errCode = (err as NodeJS.ErrnoException | null)?.code;
			if (errCode === "EINVAL" || errCode === "ENOTSUP") {
				return await open(securePath, "r");
			}
			throw err;
		});

		try {
			const file = Bun.file(securePath);
			const mime = file.type || "application/octet-stream";
			const st = await fh.stat();
			if (!st.isFile()) {
				return {
					type: "text",
					content: "",
					mime: "text/plain",
					mimeType: "text/plain",
				};
			}

			const isText =
				mime.startsWith("text/") ||
				mime.includes("json") ||
				mime.includes("xml") ||
				mime.includes("javascript") ||
				mime.includes("typescript") ||
				mime.includes("markdown");

			if (!isText) {
				return { type: "binary", content: "", mime, mimeType: mime };
			}

			const text = await fh.readFile({ encoding: "utf-8" });
			const maxChars = 1_000_000;
			if (text.length > maxChars) {
				return {
					type: "text",
					content: `${text.slice(0, maxChars)}\n\n…(truncated)…`,
					mime,
					mimeType: mime,
				};
			}
			return { type: "text", content: text, mime, mimeType: mime };
		} finally {
			await fh.close().catch(() => {});
		}
	} catch (error) {
		moduleLogError(`[readFileDirectly] Error reading ${securePath}:`, error);
		return {
			type: "text",
			content: "",
			mime: "text/plain",
			mimeType: "text/plain",
		};
	}
}

export async function readFileBinaryDirectly(
	filePath: string,
	getSecurePath: GetSecurePath,
	maxSizeMb: number = 10,
): Promise<
	{ base64: string; mime: string; size: number } | { error: "not_found" | "too_large" | "access_denied"; size?: number }
> {
	const securePath = await getSecurePath(filePath);
	if (!securePath) {
		moduleLogError(`[readFileBinaryDirectly] Access denied: ${filePath}`);
		return { error: "access_denied" };
	}

	try {
		// O_NOFOLLOW not available on Windows — symlink defense disabled there (acceptable trade-off for dev tool)
		const noFollow = Number((fsConstants as any).O_NOFOLLOW ?? 0) || 0;
		if (!noFollow) {
			const lst = await lstat(securePath).catch(() => null);
			if (lst?.isSymbolicLink()) {
				return { error: "not_found" };
			}
		}
		const flags = fsConstants.O_RDONLY | noFollow;
		const fh = await open(securePath, flags).catch(async (err) => {
			const errCode = (err as NodeJS.ErrnoException | null)?.code;
			if (errCode === "EINVAL" || errCode === "ENOTSUP") {
				return await open(securePath, "r");
			}
			throw err;
		});

		try {
			const st = await fh.stat();
			if (!st.isFile()) return { error: "not_found" };
			const size = st.size;
			const maxBytes = maxSizeMb * 1024 * 1024;
			if (size > maxBytes) {
				return { error: "too_large", size };
			}

			const buf = await fh.readFile();
			const base64 = Buffer.from(buf).toString("base64");
			const mime = Bun.file(securePath).type || "application/octet-stream";
			return { base64, mime, size };
		} finally {
			await fh.close().catch(() => {});
		}
	} catch (error) {
		moduleLogError(`[readFileBinaryDirectly] Error reading ${securePath}:`, error);
		return { error: "not_found" };
	}
}
