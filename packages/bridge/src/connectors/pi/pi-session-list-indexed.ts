/**
 * Index-backed Pi session listing.
 *
 * A listing walks the session directories, stats every file, serves each unchanged file from the
 * on-disk index, and computes only the files that are new or changed — through the head-scanning
 * `SessionInfo` builder plus one stats scan. The index is written back when anything changed, so the
 * next start pays a directory walk and a few thousand `stat`s instead of a full scan of every file.
 */

import { join } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import {
	openPiSessionIndex,
	type PiSessionIndex,
	type PiSessionIndexOptions,
} from "../../index-cache/pi-session-index";
import {
	type PiSessionIndexRecord,
	recordFromSessionInfo,
	toPiSessionInfo,
	toSdkSessionInfo,
} from "../../index-cache/pi-session-index-record";
import type { PiSessionInfo } from "../../types/pi";
import { runPool } from "../../utils/bounded-pool";
import { singleFlight } from "../../utils/single-flight";
import { buildPiSessionInfoFast } from "./pi-session-info-fast";
import { buildPiSessionInfoReadline } from "./pi-session-info-readline";
import {
	defaultSessionDirForCwd,
	getPiSessionsRoot,
	listProjectDirs,
	listSessionFileNames,
	type PiSessionFile,
	statSessionFiles,
} from "./pi-session-paths";
import { scanPiSessionStats } from "./pi-session-stats";

/** Files recomputed in parallel; each reads one file at a time, so this also bounds peak memory. */
export const PI_SESSION_INDEX_CONCURRENCY = 4;

/** Files between event-loop yields while warming in the background. */
export const PI_SESSION_WARM_YIELD_EVERY = 16;

export type IndexedSessionListOptions = PiSessionIndexOptions & {
	root?: string;
	/** Restrict the listing to the project directory of this cwd. */
	cwd?: string;
	concurrency?: number;
	/** Give the event loop a turn every few files, so a request can be served while warming. */
	yieldBetweenFiles?: boolean;
};

const refreshes = new Map<string, Promise<Map<string, PiSessionIndexRecord>>>();

const refreshKey = (options: IndexedSessionListOptions): string =>
	`${options.root ?? ""}\u0000${options.cwd ?? ""}\u0000${options.cacheRoot ?? ""}`;

/** Every `SessionInfo` the bridge sends, for every session under `root` (or for one cwd). */
export async function listIndexedPiSessions(options: IndexedSessionListOptions = {}): Promise<PiSessionInfo[]> {
	const records = await refreshSessionIndex(options);
	return sortByModifiedDesc([...records.values()]).map(toPiSessionInfo);
}

/** The same listing in the SDK's own shape, for callers that still take a `SessionInfo`. */
export async function listIndexedSdkSessionInfos(options: IndexedSessionListOptions = {}): Promise<SessionInfo[]> {
	const records = await refreshSessionIndex(options);
	return sortByModifiedDesc([...records.values()]).map(toSdkSessionInfo);
}

/** Starts a listing in the background so the first request is served from the index. */
export function warmPiSessionIndex(options: IndexedSessionListOptions = {}): Promise<void> {
	return refreshSessionIndex({ ...options, yieldBetweenFiles: true }).then(
		() => {},
		() => {},
	);
}

export function refreshSessionIndex(
	options: IndexedSessionListOptions = {},
): Promise<Map<string, PiSessionIndexRecord>> {
	return singleFlight(refreshes, refreshKey(options), () => refresh(options));
}

function sortByModifiedDesc(records: PiSessionIndexRecord[]): PiSessionIndexRecord[] {
	return records.sort((a, b) => b.modified - a.modified);
}

async function refresh(options: IndexedSessionListOptions): Promise<Map<string, PiSessionIndexRecord>> {
	const root = options.root ?? getPiSessionsRoot();
	const files = await collectSessionFiles(root, options.cwd);
	const sessionIndex = await openPiSessionIndex(options);
	const records = new Map<string, PiSessionIndexRecord>();
	const pending: Array<{ file: PiSessionFile; position: number }> = [];

	for (const file of files) {
		const cached = sessionIndex.lookup(file.path, file);
		if (cached) records.set(file.path, cached);
		else pending.push({ file, position: pending.length });
	}

	if (pending.length > 0) {
		await runPool(pending, options.concurrency ?? PI_SESSION_INDEX_CONCURRENCY, async ({ file, position }) => {
			await computeRecord(sessionIndex, file, records);
			if (options.yieldBetweenFiles && position % PI_SESSION_WARM_YIELD_EVERY === 0) await Bun.sleep(0);
		});
	}

	if (options.cwd === undefined) sessionIndex.pruneMissing(new Set(files.map((file) => file.path)));
	await sessionIndex.flush();
	return records;
}

async function computeRecord(
	sessionIndex: PiSessionIndex,
	file: PiSessionFile,
	records: Map<string, PiSessionIndexRecord>,
): Promise<void> {
	const info = await computePiSessionInfo(file);
	if (!info) return;

	const stats = await scanPiSessionStats(file.path);
	const record = recordFromSessionInfo(info, file, stats, Date.now());
	if (!record) return;

	sessionIndex.put(record);
	records.set(file.path, record);
}

/**
 * The `SessionInfo` the listing reports for one file: the stats scan first, because a file carrying a
 * readline-only line break has to be read the way the SDK reads it.
 */
export async function computePiSessionInfo(file: PiSessionFile): Promise<SessionInfo | null> {
	const stats = await scanPiSessionStats(file.path);
	if (stats.lineSeparatorInLine) return buildPiSessionInfoReadline(file.path);
	return (await buildPiSessionInfoFast(file.path, { size: file.size, mtime: file.mtime })).info;
}

async function collectSessionFiles(root: string, cwd?: string): Promise<PiSessionFile[]> {
	const dirs = cwd ? [defaultSessionDirForCwd(cwd, root)] : await listProjectDirs(root);
	const perDir = await Promise.all(dirs.map((dir) => listSessionFileNames(dir)));

	const paths: string[] = [];
	for (let position = 0; position < dirs.length; position++) {
		const dir = dirs[position] as string;
		for (const name of perDir[position] ?? []) paths.push(join(dir, name));
	}
	return statSessionFiles(paths);
}
