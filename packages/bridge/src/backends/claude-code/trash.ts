/**
 * The one way this adapter deletes a file (a transcript, a config file, a custom tool): a move to the OS trash (D19,
 * OQ5, D121), macOS `~/.Trash`, Linux the XDG trash with its `info/<name>.trashinfo`. A move never copies and never
 * removes: on a failure the files stay where they are. Where the trash lies comes from the environment the CLI is
 * given, so a test's temp `HOME` keeps it off the real one.
 */

import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import type { ActionResult } from "../../contract";
import { ACCEPTED, rejected } from "./rejections";
import type { ClaudeCodeServices } from "./services";

export interface TrashTarget {
	readonly platform: NodeJS.Platform;
	readonly home: string;
	readonly xdgDataHome: string | undefined;
	readonly now: Date;
}

const DIR_MODE = 0o700;
const MAX_NAME_TRIES = 1_000;

/** Undefined when `HOME` is not known: with an explicit config dir (a test) the process's own home is never assumed. */
export function trashTargetOf(
	env: Readonly<Record<string, string>>,
	now: Date,
	platform: NodeJS.Platform = process.platform,
): TrashTarget | undefined {
	const home = env.HOME;
	if (home === undefined || !isAbsolute(home)) return undefined;
	const xdg = env.XDG_DATA_HOME;
	return { platform, home, xdgDataHome: xdg !== undefined && isAbsolute(xdg) ? xdg : undefined, now };
}

export function servicesTrash(services: ClaudeCodeServices): TrashTarget | undefined {
	return trashTargetOf(services.cliEnv, new Date(services.clock.now()));
}

export async function moveToTrash(paths: readonly string[], target: TrashTarget | undefined): Promise<ActionResult> {
	if (target === undefined)
		return rejected("backend_error", "the trash location is unknown: no HOME in the environment");
	if (target.platform !== "darwin" && target.platform !== "linux") {
		return rejected("unsupported", `moving to the trash is not supported on ${target.platform}`);
	}
	for (const path of paths) {
		try {
			if (target.platform === "darwin") await moveToMacTrash(path, target);
			else await moveToXdgTrash(path, target);
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			return rejected("backend_error", `${basename(path)} could not be moved to the trash: ${why}`);
		}
	}
	return ACCEPTED;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

/** `name`, else `stem 2.ext`, `stem 3.ext`…: Finder's way of keeping both. */
function candidateName(name: string, attempt: number): string {
	if (attempt === 1) return name;
	const extension = extname(name);
	return `${name.slice(0, name.length - extension.length)} ${attempt}${extension}`;
}

async function moveToMacTrash(path: string, target: TrashTarget): Promise<void> {
	const trash = join(target.home, ".Trash");
	await mkdir(trash, { recursive: true, mode: DIR_MODE });
	for (let attempt = 1; attempt <= MAX_NAME_TRIES; attempt++) {
		const destination = join(trash, candidateName(basename(path), attempt));
		if (await exists(destination)) continue;
		await rename(path, destination);
		return;
	}
	throw new Error("no free name in the trash");
}

async function moveToXdgTrash(path: string, target: TrashTarget): Promise<void> {
	const root = join(target.xdgDataHome ?? join(target.home, ".local", "share"), "Trash");
	await mkdir(join(root, "files"), { recursive: true, mode: DIR_MODE });
	await mkdir(join(root, "info"), { recursive: true, mode: DIR_MODE });
	for (let attempt = 1; attempt <= MAX_NAME_TRIES; attempt++) {
		const name = candidateName(basename(path), attempt);
		const info = join(root, "info", `${name}.trashinfo`);
		if (await exists(join(root, "files", name))) continue;
		try {
			await writeFile(info, trashInfo(path, target.now), {
				flag: "wx",
				mode: 0o600,
			});
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EEXIST") continue;
			throw error;
		}
		try {
			await rename(path, join(root, "files", name));
		} catch (error) {
			await unlink(info).catch(() => undefined);
			throw error;
		}
		return;
	}
	throw new Error("no free name in the trash");
}

function trashInfo(path: string, now: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	return `[Trash Info]\nPath=${encoded}\nDeletionDate=${date}\n`;
}
