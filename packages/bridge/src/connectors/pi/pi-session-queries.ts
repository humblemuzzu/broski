import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getAgentDir, SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import type { PiSessionInfo, ProjectSummary } from "../../types";
import { normalizeCwd } from "./pi-cwd";
import { listInstances } from "./pi-instance";
import type { PiAvailability } from "./pi-instance-types";
import { ensurePiModelRuntime, logPiModelRuntimeErrors } from "./pi-model-runtime";
import { enrichSessionsWithStats, mapSessionInfo } from "./pi-session-info";
import { createNewSession } from "./pi-session-lifecycle";
import { listAllSessionInfos, listProjectSummaries, listSessionInfosForCwd } from "./pi-session-list-cache";
import { singleFlight } from "./pi-single-flight";

const getSessionsRoot = (): string => resolve(getAgentDir(), "sessions");

const listSessionsInFlight = new Map<string, Promise<PiSessionInfo[]>>();
const listProjectsInFlight = new Map<string, Promise<ProjectSummary[]>>();

export function listSessions(cwd?: string): Promise<PiSessionInfo[]> {
	const resolvedCwd = cwd ? normalizeCwd(cwd) : undefined;

	return singleFlight(listSessionsInFlight, resolvedCwd ?? "", async () => {
		const sessions = resolvedCwd ? await listSessionInfosForCwd(resolvedCwd) : await listAllSessionInfos();
		const mapped = sessions.map(mapSessionInfo);
		await enrichSessionsWithStats(mapped);
		return mapped;
	});
}

export function listProjects(): Promise<ProjectSummary[]> {
	return singleFlight(listProjectsInFlight, "pi", () => listProjectSummaries());
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
