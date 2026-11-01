/**
 * Lane A · whether a session's `customTitle` is the user's. The SDK's lite read folds the AI title into `customTitle`
 * when no custom title exists (`sdk.mjs` `ml`: `customTitle(tail) ‖ custom-title.json ‖ customTitle(head) ‖
 * aiTitle(tail) ‖ aiTitle(head)`), so the store looks where the SDK looked: the last and first 64 KiB of the transcript
 * and the session's `custom-title.json`. Cached by the file's size and mtime.
 */

import { open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { boundedGrowth } from "./bounded";
import type { FileLocator } from "./locator";
import { stampOf } from "./locator";

/** The SDK's lite-read window (`sdk.mjs` `En=65536`). */
const WINDOW_BYTES = 65_536;
const MAX_CACHED = 4_096;
const CUSTOM_TITLE_KEYS = ['"customTitle":"', '"customTitle": "'];

export class TitleSources {
	private readonly known = new Map<string, { readonly stamp: string; readonly user: boolean }>();

	constructor(private readonly locator: FileLocator) {}

	/** True when a custom title written by a person (a `custom-title` entry or the sidecar) is there. */
	async userTitled(sessionId: string, known?: string): Promise<boolean> {
		const path = known ?? (await this.locator.find(sessionId));
		const stamp = path === undefined ? undefined : await stampOf(path);
		if (path === undefined || stamp === undefined) return false;
		const key = `${stamp.size}:${stamp.mtimeMs}`;
		const cached = this.known.get(sessionId);
		if (cached?.stamp === key) return cached.user;
		const user = await customTitleIn(path, sessionId, stamp.size);
		this.known.delete(sessionId);
		this.known.set(sessionId, { stamp: key, user });
		boundedGrowth(this.known, MAX_CACHED);
		return user;
	}
}

async function customTitleIn(path: string, sessionId: string, size: number): Promise<boolean> {
	try {
		const handle = await open(path, "r");
		try {
			if (hasCustomTitle(await windowAt(handle, Math.max(0, size - WINDOW_BYTES), size))) return true;
			if (await sidecarTitled(join(dirname(path), sessionId, "custom-title.json"))) return true;
			return hasCustomTitle(await windowAt(handle, 0, size));
		} finally {
			await handle.close();
		}
	} catch {
		return false;
	}
}

async function windowAt(handle: Awaited<ReturnType<typeof open>>, from: number, size: number): Promise<string> {
	const buffer = Buffer.alloc(Math.min(WINDOW_BYTES, size - from));
	const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
	return buffer.toString("utf8", 0, bytesRead);
}

function hasCustomTitle(text: string): boolean {
	return CUSTOM_TITLE_KEYS.some((key) => text.includes(key));
}

async function sidecarTitled(path: string): Promise<boolean> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			"customTitle" in parsed &&
			typeof parsed.customTitle === "string" &&
			parsed.customTitle.trim() !== ""
		);
	} catch {
		return false;
	}
}
