/** The transcript files of a session's subagents and their `.meta.json` sidecars (D20). */

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const MAX_DEPTH = 8;
const MAX_FILES = 2_000;
const MAX_META_BYTES = 64 * 1_024;
const AGENT_PREFIX = "agent-";

export interface SubagentFile {
	readonly agentId: string;
	readonly path: string;
	readonly mtimeMs: number;
	readonly birthtimeMs: number;
}

export interface SubagentMeta {
	readonly agentType?: string;
	readonly description?: string;
	readonly toolUseId?: string;
}

const MetaFile = z.object({
	agentType: z.string().optional().catch(undefined),
	description: z.string().optional().catch(undefined),
	toolUseId: z.string().optional().catch(undefined),
});

/** `<project>/<sessionId>/subagents`, beside the transcript at `transcriptPath`. */
export function subagentsDir(transcriptPath: string, sessionId: string): string {
	return join(dirname(transcriptPath), sessionId, "subagents");
}

/** Every `agent-<id>.jsonl` under `dir`, nested layouts included (`sdk.mjs` `OF`), bounded. */
export async function scanSubagents(dir: string): Promise<Map<string, SubagentFile>> {
	const found = new Map<string, SubagentFile>();
	await visit(dir, 0, found);
	return found;
}

async function visit(dir: string, depth: number, found: Map<string, SubagentFile>): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (found.size >= MAX_FILES) return;
		const path = join(dir, entry.name);
		if (entry.isDirectory() && depth < MAX_DEPTH) await visit(path, depth + 1, found);
		else if (entry.isFile() && entry.name.startsWith(AGENT_PREFIX) && entry.name.endsWith(".jsonl")) {
			const agentId = entry.name.slice(AGENT_PREFIX.length, -".jsonl".length);
			const file = await fileOf(agentId, path);
			if (file !== undefined && !found.has(agentId)) found.set(agentId, file);
		}
	}
}

async function fileOf(agentId: string, path: string): Promise<SubagentFile | undefined> {
	try {
		const stats = await stat(path);
		return {
			agentId,
			path,
			mtimeMs: Math.trunc(stats.mtimeMs),
			birthtimeMs: Math.trunc(stats.birthtimeMs),
		};
	} catch {
		return undefined;
	}
}

/** The sidecar beside an agent file; empty when it is missing, too large or not JSON. */
export async function readSubagentMeta(file: SubagentFile): Promise<SubagentMeta> {
	const path = file.path.replace(/\.jsonl$/, ".meta.json");
	try {
		if ((await stat(path)).size > MAX_META_BYTES) return {};
		const parsed = MetaFile.safeParse(JSON.parse(await readFile(path, "utf8")));
		return parsed.success ? parsed.data : {};
	} catch {
		return {};
	}
}
