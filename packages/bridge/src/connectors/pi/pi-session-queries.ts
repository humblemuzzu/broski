import { rm } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { getAgentDir, SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import type { PiSessionInfo, ProjectSummary } from "../../types";
import { normalizeCwd } from "./pi-cwd";
import { listInstances } from "./pi-instance";
import type { PiAvailability } from "./pi-instance-types";
import { ensurePiModelRuntime, logPiModelRuntimeErrors } from "./pi-model-runtime";
import { enrichSessionsWithStats, mapSessionInfo } from "./pi-session-info";
import { createNewSession } from "./pi-session-lifecycle";

const getSessionsRoot = (): string => resolve(getAgentDir(), "sessions");

export async function listSessions(cwd?: string): Promise<PiSessionInfo[]> {
	const sessions = cwd ? await SessionManager.list(normalizeCwd(cwd)) : await SessionManager.listAll();
	const mapped = sessions.map(mapSessionInfo);
	await enrichSessionsWithStats(mapped);
	return mapped;
}

export async function listProjects(): Promise<ProjectSummary[]> {
	const sessions = await SessionManager.listAll();
	const byPath = new Map<string, { path: string; name: string; lastOpened: number }>();

	for (const session of sessions) {
		const cwd = session.cwd;
		if (!cwd) continue;

		const path = resolve(cwd);
		const lastOpened = session.modified.getTime();
		const existing = byPath.get(path);

		if (!existing || lastOpened > existing.lastOpened) {
			byPath.set(path, {
				path,
				name: basename(path) || path,
				lastOpened,
			});
		}
	}

	return Array.from(byPath.values())
		.sort((a, b) => b.lastOpened - a.lastOpened)
		.map((p) => ({
			id: p.path,
			name: p.name,
			path: p.path,
			lastOpened: p.lastOpened,
		}));
}

export async function isPiAvailable(): Promise<PiAvailability> {
	try {
		const runtime = await ensurePiModelRuntime();
		logPiModelRuntimeErrors(runtime);
		const models = runtime.getAvailableSnapshot();
		return {
			available: true,
			authenticated: models.length > 0,
			modelCount: models.length,
			version: VERSION,
		};
	} catch {
		return {
			available: false,
			authenticated: false,
			modelCount: 0,
		};
	}
}

export async function deleteSession(sessionPath: string): Promise<boolean> {
	const resolvedPath = resolve((sessionPath || "").trim());
	const sessionsRoot = getSessionsRoot();

	if (!resolvedPath.endsWith(".jsonl")) return false;
	if (resolvedPath !== sessionsRoot && !resolvedPath.startsWith(`${sessionsRoot}${sep}`)) return false;

	try {
		await rm(resolvedPath, { force: true });

		for (const instance of listInstances()) {
			const currentFile = instance.session.sessionFile ? resolve(instance.session.sessionFile) : null;
			if (currentFile === resolvedPath) {
				await createNewSession(instance);
			}
		}

		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve a Pi session ID to the JSONL file path on disk.
 * Returns null if the session file cannot be found.
 */
export async function resolveSessionFilePath(sessionId: string): Promise<string | null> {
	for (const instance of listInstances()) {
		if (instance.session.sessionId === sessionId && instance.session.sessionFile) {
			return resolve(instance.session.sessionFile);
		}
	}

	try {
		const sessions = await SessionManager.listAll();
		for (const session of sessions) {
			if (session.id === sessionId && session.path) {
				return resolve(session.path);
			}
		}
	} catch {
		// ignore
	}

	return null;
}

/** Check if a Pi session is owned by the bridge (has an active instance). */
export function isSessionOwnedByBridge(sessionId: string): boolean {
	for (const instance of listInstances()) {
		if (instance.session.sessionId === sessionId) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a Pi session is actively streaming through a bridge-owned instance.
 * This is stricter than isSessionOwnedByBridge — returns true ONLY if the
 * bridge instance is currently processing a prompt (isStreaming). An idle
 * instance (e.g. created by pi_get_state after a bridge restart) returns false,
 * allowing the external tail to run instead.
 */
export function isSessionActivelyStreaming(sessionId: string): boolean {
	for (const instance of listInstances()) {
		if (instance.session.sessionId === sessionId && instance.session.isStreaming) {
			return true;
		}
	}
	return false;
}
