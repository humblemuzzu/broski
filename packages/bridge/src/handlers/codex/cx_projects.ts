/**
 * `cx_list_projects` source resolution.
 *
 * The SQLite index holds every thread's cwd behind an indexed `GROUP BY`, so it answers for a
 * thousand threads in milliseconds. Walking the rollout tree is the fallback for a machine without
 * an index, and cold-starting the app-server is the fallback for that.
 */

import { basename } from "node:path";
import type { CodexAppServerClient } from "../../connectors/codex";
import { findCodexStateDbPath, listProjectsFromDb } from "../../connectors/codex/cx-sqlite";
import type { ProjectSummary } from "../../types";

export type CxProjectSource = "sqlite" | "filesystem" | "app-server" | "none";

export type CxProjectsResult = {
	projects: ProjectSummary[];
	source: CxProjectSource;
};

export type CxProjectsContext = {
	listProjectsFromFs: () => Promise<ProjectSummary[]>;
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (value: unknown) => string;
	logInfo: (message: string) => void;
};

function asRecordLike(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function listProjectsFromAppServer(ctx: CxProjectsContext): Promise<ProjectSummary[]> {
	const client = await ctx.ensureCodexClient();
	const result = asRecordLike(await client.request("thread/list", { limit: 200 }));
	const threads = Array.isArray(result.data) ? result.data : [];
	const byPath = new Map<string, ProjectSummary>();
	for (const thread of threads) {
		const path = ctx.safeString(asRecordLike(thread).cwd).trim();
		if (!path) continue;
		byPath.set(path, { id: path, name: basename(path) || path, path });
	}
	return Array.from(byPath.values());
}

export async function resolveCxProjects(ctx: CxProjectsContext): Promise<CxProjectsResult> {
	const dbPath = findCodexStateDbPath();
	if (dbPath) {
		// A database locked by a running Codex, or one whose schema moved on, is a reason to read the
		// rollout tree, not to fail the listing.
		try {
			const fromIndex = listProjectsFromDb(dbPath);
			if (fromIndex.length > 0) {
				ctx.logInfo(`[cx_list_projects] ${fromIndex.length} projects from the SQLite index`);
				return { projects: fromIndex, source: "sqlite" };
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.logInfo(`[cx_list_projects] SQLite index unavailable: ${message}`);
		}
	}

	const fromFiles = await ctx.listProjectsFromFs();
	if (fromFiles.length > 0) {
		ctx.logInfo(`[cx_list_projects] ${fromFiles.length} projects from rollout files`);
		return { projects: fromFiles, source: "filesystem" };
	}

	try {
		const fromClient = await listProjectsFromAppServer(ctx);
		ctx.logInfo(`[cx_list_projects] ${fromClient.length} projects from the app-server`);
		return { projects: fromClient, source: "app-server" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.logInfo(`[cx_list_projects] app-server fallback unavailable: ${message}`);
	}

	return { projects: [], source: "none" };
}
