import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { type FileContent, MAX_NAME_CHARS, MAX_PATH_CHARS } from "../../../contract";
import { clipStart } from "../bounds";

const IMAGE_MIMES: Readonly<Record<string, string>> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".heic": "image/heic",
	".heif": "image/heif",
	".avif": "image/avif",
	".bmp": "image/bmp",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

const MAX_EXTRACTED = 10;
const MAX_SCAN_CHARS = 32_768;
const PI_CLIPBOARD_RE = /^pi-clipboard-[0-9a-f-]+\.[a-z0-9]+$/i;
const PATH_TOKEN_RE =
	/(?:'((?:file:\/\/|\/|~\/|\.\.?\/)[^'\n]+)'|"((?:file:\/\/|\/|~\/|\.\.?\/)[^"\n]+)"|((?:file:\/\/|\/|~\/|\.\.?\/)(?:[^\s"'`<>()[\]{}\\]|\\ )+))/g;

export interface ExtractedUserImages {
	readonly text: string;
	readonly files: readonly FileContent[];
}

export function extractUserImagePaths(text: string, cwd: string | undefined): ExtractedUserImages {
	if (text.length === 0 || !text.includes("/")) return { text, files: [] };
	const slice = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
	const files: FileContent[] = [];
	const seen = new Set<string>();
	const stripSpans: { start: number; end: number }[] = [];

	for (const match of slice.matchAll(PATH_TOKEN_RE)) {
		if (files.length >= MAX_EXTRACTED) break;
		const raw = match[1] ?? match[2] ?? match[3];
		if (!raw) continue;
		const unescaped = match[3] !== undefined ? raw.replace(/\\ /g, " ") : raw;
		const candidate = cleanPath(unescaped);
		const mimeType = mimeOf(candidate);
		if (mimeType === undefined) continue;
		const resolved = resolveLocalPath(candidate, cwd);
		if (resolved === undefined || resolved.length > MAX_PATH_CHARS || seen.has(resolved)) continue;
		if (!isExistingFile(resolved)) continue;
		seen.add(resolved);
		const name = basename(resolved);
		files.push({
			kind: "file",
			uri: resolved,
			mimeType,
			...(name !== "" && { name: clipStart(name, MAX_NAME_CHARS) }),
		});
		if (PI_CLIPBOARD_RE.test(name) && match.index !== undefined) {
			stripSpans.push({ start: match.index, end: match.index + match[0].length });
		}
	}

	if (stripSpans.length === 0) return { text, files };
	return { text: removeSpans(text, stripSpans), files };
}

function cleanPath(raw: string): string {
	let path = raw.trim();
	if (path.toLowerCase().startsWith("file://")) {
		try {
			path = decodeURIComponent(path.slice("file://".length));
		} catch {
			path = path.slice("file://".length);
		}
	}
	return path.replace(/[.,;:!?]+$/, "");
}

function mimeOf(path: string): string | undefined {
	const ext = extname(path).toLowerCase();
	return IMAGE_MIMES[ext];
}

function resolveLocalPath(path: string, cwd: string | undefined): string | undefined {
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	if (isAbsolute(path)) return resolve(path);
	if (cwd && (path.startsWith("./") || path.startsWith("../"))) return resolve(cwd, path);
	return undefined;
}

function isExistingFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function removeSpans(text: string, spans: readonly { start: number; end: number }[]): string {
	let out = "";
	let cursor = 0;
	for (const span of spans) {
		out += text.slice(cursor, span.start);
		cursor = span.end;
	}
	out += text.slice(cursor);
	return out
		.split("\n")
		.map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
		.filter((line, index, lines) => line !== "" || (index > 0 && index < lines.length - 1 && lines[index - 1] !== ""))
		.join("\n")
		.trim();
}
