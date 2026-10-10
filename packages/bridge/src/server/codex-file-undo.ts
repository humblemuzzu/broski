import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { BridgeState } from "./state";
import { safeString } from "./util";

type FileSnapshotEntry = {
	path: string;
	kind: "add" | "delete" | "update";
	movePath?: string | null;
	existed: boolean;
	contentFile?: string | null;
	targetExisted?: boolean;
	targetContentFile?: string | null;
};

export type CodexFileUndo = {
	ensureUndoStack: (threadId: string) => string[];
	applyCodexUndo: (threadId: string, key: string) => Promise<string[]>;
	snapshotCodexFileChange: (threadId: string, turnId: string, itemId: string, item: any) => Promise<void>;
};

/**
 * Snapshots the files a Codex file-change item is about to touch, so "undo" can restore them from
 * the manifest written under `.broski/codex-undo/`.
 */
export function createCodexFileUndo(deps: {
	state: BridgeState;
	getSecurePath: (path: string) => Promise<string | null>;
}): CodexFileUndo {
	const { state } = deps;

	const safeResolveInCwd = (cwd: string, relativePath: string): string => {
		const abs = resolve(cwd, relativePath);
		const normalizedCwd = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`;
		if (abs === cwd || abs.startsWith(normalizedCwd)) return abs;
		return resolve(cwd, relativePath.replace(/^\/*/, ""));
	};

	const ensureUndoStack = (threadId: string): string[] => {
		const existing = state.cxUndoStackByThread.get(threadId);
		if (existing) return existing;
		const created: string[] = [];
		state.cxUndoStackByThread.set(threadId, created);
		return created;
	};

	const snapshotCodexFileChange = async (
		threadId: string,
		turnId: string,
		itemId: string,
		item: any,
	): Promise<void> => {
		const cwd = state.cxThreadCwds.get(threadId);
		if (!cwd) return;
		const changes = Array.isArray(item?.changes) ? item.changes : [];
		if (changes.length === 0) return;

		const baseDir = resolve(cwd, ".broski", "codex-undo", threadId, turnId, itemId);
		const filesDir = resolve(baseDir, "files");
		await mkdir(filesDir, { recursive: true });

		const entries: FileSnapshotEntry[] = [];
		let idx = 0;

		for (const c of changes) {
			const relPath = safeString(c?.path);
			const kindObj = c?.kind;
			const kindType = safeString(kindObj?.type).toLowerCase();
			const kind: FileSnapshotEntry["kind"] = kindType === "add" ? "add" : kindType === "delete" ? "delete" : "update";
			const movePathRaw = safeString(kindObj?.movePath);
			const movePath = movePathRaw ? movePathRaw : null;

			const absPath = safeResolveInCwd(cwd, relPath);
			let existed = false;
			let contentFile: string | null = null;
			try {
				await stat(absPath);
				existed = true;
				const buf = await readFile(absPath);
				const name = `orig_${idx}.bin`;
				await writeFile(resolve(filesDir, name), buf);
				contentFile = name;
			} catch {
				existed = false;
			}

			let targetExisted: boolean | undefined;
			let targetContentFile: string | null = null;
			if (movePath) {
				const targetAbs = safeResolveInCwd(cwd, movePath);
				try {
					await stat(targetAbs);
					targetExisted = true;
					const buf = await readFile(targetAbs);
					const name = `target_${idx}.bin`;
					await writeFile(resolve(filesDir, name), buf);
					targetContentFile = name;
				} catch {
					targetExisted = false;
				}
			}

			entries.push({
				path: relPath,
				kind,
				movePath,
				existed,
				contentFile,
				...(movePath ? { targetExisted, targetContentFile } : {}),
			});
			idx++;
		}

		const manifest = {
			threadId,
			turnId,
			itemId,
			cwd,
			createdAt: Math.floor(Date.now() / 1000),
			entries,
		};
		const manifestPath = resolve(baseDir, "manifest.json");
		await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

		const key = `${threadId}:${turnId}:${itemId}`;
		state.cxFileChangeSnapshots.set(key, manifestPath);
	};

	const applyCodexUndo = async (threadId: string, key: string): Promise<string[]> => {
		const manifestPath = state.cxFileChangeSnapshots.get(key);
		if (!manifestPath) return [];
		const raw = await readFile(manifestPath, "utf8");
		const parsed = JSON.parse(raw) as {
			cwd: string;
			entries: FileSnapshotEntry[];
		};
		const secureCwd = await deps.getSecurePath(parsed.cwd);
		if (!secureCwd) return [];
		const cwd = secureCwd;
		const reverted: string[] = [];
		const filesDir = resolve(dirname(manifestPath), "files");

		const restoreFile = async (rel: string, existed: boolean, contentFile?: string | null) => {
			const abs = safeResolveInCwd(cwd, rel);
			if (!existed) {
				await rm(abs, { force: true });
				reverted.push(rel);
				return;
			}
			if (!contentFile) return;
			const buf = await readFile(resolve(filesDir, contentFile));
			await mkdir(dirname(abs), { recursive: true });
			await writeFile(abs, buf);
			reverted.push(rel);
		};

		for (const e of parsed.entries) {
			if (e.kind === "update" && e.movePath) {
				await restoreFile(e.movePath, e.targetExisted === true, e.targetContentFile);
				await restoreFile(e.path, e.existed, e.contentFile);
			} else {
				await restoreFile(e.path, e.existed, e.contentFile);
			}
		}

		const stack = ensureUndoStack(threadId);
		const idx = stack.lastIndexOf(key);
		if (idx >= 0) stack.splice(idx, 1);
		state.cxFileChangeSnapshots.delete(key);
		return reverted;
	};

	return { ensureUndoStack, applyCodexUndo, snapshotCodexFileChange };
}
