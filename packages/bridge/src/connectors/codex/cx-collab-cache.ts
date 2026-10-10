/**
 * Persists Codex collab agent parent-child relationships.
 *
 * When collab_spawn_end fires, we record { senderThreadId → newThreadId, nickname, role }.
 * This survives reconnects — the bridge can look up parent threads for collab agents
 * even after the in-memory collab tree is gone.
 *
 * Storage: JSON file at ~/.codex/broski-collab-cache.json, newest relations only, written through a
 * 0600 temp file and a rename.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CollabRelation = {
	parentThreadId: string;
	childThreadId: string;
	nickname?: string;
	role?: string;
	prompt?: string;
	createdAt: number;
};

/** Relations kept on disk; a machine that spawns collab agents for months would otherwise grow forever. */
export const COLLAB_CACHE_MAX_ENTRIES = 512;

const CACHE_FILE_MODE = 0o600;

let cachePathOverride: string | null = null;
let cache: CollabRelation[] | null = null;

export function collabCachePath(): string {
	if (cachePathOverride) return cachePathOverride;
	const fromEnv = process.env.BROSKI_COLLAB_CACHE_PATH?.trim();
	if (fromEnv) return fromEnv;
	return join(homedir(), ".codex", "broski-collab-cache.json");
}

/** Points the cache at another file, for tests and tools; drops whatever was loaded. */
export function setCollabCachePath(path: string | null): void {
	cachePathOverride = path;
	cache = null;
}

function loadCache(): CollabRelation[] {
	if (cache !== null) return cache;
	const path = collabCachePath();
	try {
		if (existsSync(path)) {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
			cache = Array.isArray(parsed) ? parsed.filter(isRelation) : [];
			return cache;
		}
	} catch {
		// Corrupted cache — start fresh
	}
	cache = [];
	return cache;
}

function isRelation(value: unknown): value is CollabRelation {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.parentThreadId === "string" && typeof record.childThreadId === "string";
}

function sortableCreatedAt(relation: CollabRelation): number {
	return typeof relation.createdAt === "number" ? relation.createdAt : 0;
}

/** Keeps the newest `COLLAB_CACHE_MAX_ENTRIES` relations, oldest dropped first. */
function capRelations(relations: CollabRelation[]): CollabRelation[] {
	if (relations.length <= COLLAB_CACHE_MAX_ENTRIES) return relations;
	return [...relations].sort((a, b) => sortableCreatedAt(b) - sortableCreatedAt(a)).slice(0, COLLAB_CACHE_MAX_ENTRIES);
}

function saveCache(): void {
	const path = collabCachePath();
	const tmpPath = `${path}.tmp`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		cache = capRelations(cache ?? []);
		writeFileSync(tmpPath, JSON.stringify(cache, null, 2), { encoding: "utf-8", mode: CACHE_FILE_MODE });
		renameSync(tmpPath, path);
	} catch {
		try {
			unlinkSync(tmpPath);
		} catch {
			// Best-effort persistence
		}
	}
}

/** Record a collab spawn relationship. Called when collab_spawn_end fires. */
export function recordCollabSpawn(
	parentThreadId: string,
	childThreadId: string,
	nickname?: string | null,
	role?: string | null,
	prompt?: string,
): void {
	const relations = loadCache();
	// Don't duplicate
	const existing = relations.find((r) => r.parentThreadId === parentThreadId && r.childThreadId === childThreadId);
	if (existing) return;

	relations.push({
		parentThreadId,
		childThreadId,
		nickname: nickname ?? undefined,
		role: role ?? undefined,
		prompt: prompt?.slice(0, 500),
		createdAt: Date.now(),
	});
	saveCache();
}

/** Get all children spawned by a given parent thread. */
export function getCollabChildren(parentThreadId: string): CollabRelation[] {
	return loadCache().filter((r) => r.parentThreadId === parentThreadId);
}

/** Get the parent thread for a given child (collab-spawned agent). */
export function getCollabParent(childThreadId: string): CollabRelation | undefined {
	return loadCache().find((r) => r.childThreadId === childThreadId);
}

/** Get all recorded collab relations. */
export function getAllCollabRelations(): CollabRelation[] {
	return loadCache();
}
