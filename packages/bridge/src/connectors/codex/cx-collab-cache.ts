/**
 * Persists Codex collab agent parent-child relationships.
 *
 * When collab_spawn_end fires, we record { senderThreadId → newThreadId, nickname, role }.
 * This survives reconnects — the bridge can look up parent threads for collab agents
 * even after the in-memory collab tree is gone.
 *
 * Storage: JSON file at ~/.codex/broski-collab-cache.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CollabRelation = {
	parentThreadId: string;
	childThreadId: string;
	nickname?: string;
	role?: string;
	prompt?: string;
	createdAt: number;
};

const CACHE_DIR = join(homedir(), ".codex");
const CACHE_FILE = join(CACHE_DIR, "broski-collab-cache.json");

let cache: CollabRelation[] | null = null;

function ensureDir(): void {
	if (!existsSync(CACHE_DIR)) {
		mkdirSync(CACHE_DIR, { recursive: true });
	}
}

function loadCache(): CollabRelation[] {
	if (cache !== null) return cache;
	try {
		if (existsSync(CACHE_FILE)) {
			const raw = readFileSync(CACHE_FILE, "utf-8");
			cache = JSON.parse(raw) as CollabRelation[];
			return cache;
		}
	} catch {
		// Corrupted cache — start fresh
	}
	cache = [];
	return cache;
}

function saveCache(): void {
	ensureDir();
	try {
		writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
	} catch {
		// Best-effort persistence
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
	const existing = relations.find(
		(r) => r.parentThreadId === parentThreadId && r.childThreadId === childThreadId,
	);
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
