/**
 * Directory-level cache of Pi `SessionInfo` listings.
 *
 * The SDK's per-file `buildSessionInfo` is not exported, so the cheapest way to
 * reuse it is `SessionManager.listAll(dir)`, which is cached per project
 * directory and keyed by the `(name, mtimeMs, size)` fingerprint of the dir's
 * files. A warm call therefore only re-reads directories whose files changed.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { getAgentDir, type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ProjectSummary } from "../../types";
import { runPool } from "../../utils/bounded-pool";
import { singleFlight } from "./pi-single-flight";

export type SessionInfoLister = (dir: string) => Promise<SessionInfo[]>;

export type SessionListOptions = {
	root?: string;
	lister?: SessionInfoLister;
	concurrency?: number;
	maxCacheBytes?: number;
};

/** Directories listed in parallel. Each listing then reads files with the SDK's own pool of 10. */
export const PI_SESSION_LIST_CONCURRENCY = 4;

/** Concurrent `stat` calls while fingerprinting one directory. */
export const PI_SESSION_FINGERPRINT_CONCURRENCY = 16;

/** Evict least-recently-used directories above this many bytes of cached `SessionInfo`. */
export const PI_SESSION_LIST_CACHE_MAX_BYTES = 512 * 1024 * 1024;

const defaultLister: SessionInfoLister = (dir) => SessionManager.listAll(dir);

const getSessionsRoot = (): string => resolve(getAgentDir(), "sessions");

const encodeCwdDir = (cwd: string): string =>
	`--${resolve(cwd)
		.replace(/^[/\\]/, "")
		.replace(/[/\\:]/g, "-")}--`;

export const defaultSessionDirForCwd = (cwd: string, root: string = getSessionsRoot()): string =>
	join(root, encodeCwdDir(cwd));

type DirEntry = { signature: string; infos: SessionInfo[]; bytes: number };

const dirCache = new Map<string, DirEntry>();
const dirInFlight = new Map<string, Promise<SessionInfo[]>>();
let cachedBytes = 0;

export function clearPiSessionListCache(): void {
	dirCache.clear();
	dirInFlight.clear();
	cachedBytes = 0;
}

export function getPiSessionListCacheStats(): { dirs: number; bytes: number } {
	return { dirs: dirCache.size, bytes: cachedBytes };
}

function estimateBytes(infos: SessionInfo[]): number {
	let bytes = 0;
	for (const info of infos) {
		bytes += 160;
		bytes += 2 * (info.path.length + info.id.length + info.cwd.length + info.firstMessage.length);
		bytes += 2 * info.allMessagesText.length;
		bytes += 2 * (info.name?.length ?? 0);
		bytes += 2 * (info.parentSessionPath?.length ?? 0);
	}
	return bytes;
}

function touch(dir: string, entry: DirEntry): void {
	dirCache.delete(dir);
	dirCache.set(dir, entry);
}

function evictOverBudget(maxBytes: number): void {
	while (cachedBytes > maxBytes && dirCache.size > 1) {
		const oldest = dirCache.keys().next().value;
		if (oldest === undefined) return;
		const entry = dirCache.get(oldest);
		dirCache.delete(oldest);
		if (entry) cachedBytes -= entry.bytes;
	}
}

function store(dir: string, signature: string, infos: SessionInfo[], maxBytes: number): void {
	const previous = dirCache.get(dir);
	if (previous) cachedBytes -= previous.bytes;
	dirCache.delete(dir);
	const bytes = estimateBytes(infos);
	dirCache.set(dir, { signature, infos, bytes });
	cachedBytes += bytes;
	evictOverBudget(maxBytes);
}

async function fingerprintDir(dir: string): Promise<string | null> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return null;
	}

	const files = names.filter((name) => name.endsWith(".jsonl")).sort();
	const markers: Array<string | undefined> = files.map(() => undefined);

	await runPool(
		files.map((name, index) => ({ name, index })),
		PI_SESSION_FINGERPRINT_CONCURRENCY,
		async ({ name, index }) => {
			try {
				const fileStat = await stat(join(dir, name));
				markers[index] = `${name}:${fileStat.mtimeMs}:${fileStat.size}`;
			} catch {
				markers[index] = undefined;
			}
		},
	);

	const present = markers.filter((marker): marker is string => marker !== undefined);
	return `${files.length}:${present.join("\n")}`;
}

async function loadDir(dir: string, lister: SessionInfoLister, maxBytes: number): Promise<SessionInfo[]> {
	const signature = await fingerprintDir(dir);
	if (signature === null) return [];

	const cached = dirCache.get(dir);
	if (cached && cached.signature === signature) {
		touch(dir, cached);
		return cached.infos;
	}

	const infos = await lister(dir);
	store(dir, signature, infos, maxBytes);
	return infos;
}

function loadDirSingleFlight(dir: string, lister: SessionInfoLister, maxBytes: number): Promise<SessionInfo[]> {
	return singleFlight(dirInFlight, dir, () => loadDir(dir, lister, maxBytes));
}

function sortByModifiedDesc(infos: SessionInfo[]): SessionInfo[] {
	return [...infos].sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

async function listProjectDirs(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => join(root, entry.name));
	} catch {
		return [];
	}
}

export async function listSessionInfosForCwd(cwd: string, options: SessionListOptions = {}): Promise<SessionInfo[]> {
	const root = options.root ?? getSessionsRoot();
	const lister = options.lister ?? defaultLister;
	const maxBytes = options.maxCacheBytes ?? PI_SESSION_LIST_CACHE_MAX_BYTES;
	const dir = defaultSessionDirForCwd(cwd, root);
	return sortByModifiedDesc(await loadDirSingleFlight(dir, lister, maxBytes));
}

export async function listAllSessionInfos(options: SessionListOptions = {}): Promise<SessionInfo[]> {
	const root = options.root ?? getSessionsRoot();
	const lister = options.lister ?? defaultLister;
	const concurrency = options.concurrency ?? PI_SESSION_LIST_CONCURRENCY;
	const maxBytes = options.maxCacheBytes ?? PI_SESSION_LIST_CACHE_MAX_BYTES;

	const dirs = await listProjectDirs(root);
	const perDir: SessionInfo[][] = dirs.map(() => []);

	await runPool(
		dirs.map((dir, index) => ({ dir, index })),
		concurrency,
		async ({ dir, index }) => {
			perDir[index] = await loadDirSingleFlight(dir, lister, maxBytes);
		},
	);

	return sortByModifiedDesc(perDir.flat());
}

export async function listProjectSummaries(options: SessionListOptions = {}): Promise<ProjectSummary[]> {
	const sessions = await listAllSessionInfos(options);
	const byPath = new Map<string, { path: string; name: string; lastOpened: number }>();

	for (const session of sessions) {
		const cwd = session.cwd;
		if (!cwd) continue;

		const path = resolve(cwd);
		const lastOpened = session.modified.getTime();
		const existing = byPath.get(path);

		if (!existing || lastOpened > existing.lastOpened) {
			byPath.set(path, { path, name: basename(path) || path, lastOpened });
		}
	}

	return Array.from(byPath.values())
		.sort((a, b) => b.lastOpened - a.lastOpened)
		.map((project) => ({
			id: project.path,
			name: project.name,
			path: project.path,
			lastOpened: project.lastOpened,
		}));
}
