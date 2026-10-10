import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeCodeSession, ClaudeCodeTranscriptMessage, ProjectSummary } from "../../types";
import { CLAUDE_PROJECTS_DIR, findSessionFile, getProjectSessionsDir } from "./cc-paths";
import { listProjectsFromClaudeDirs } from "./cc-project-list";
import { listSessionsFromProjects } from "./cc-session-list";
import { readSessionPreviewCached } from "./cc-session-preview";
import { computeCCSessionStats } from "./cc-session-stats";
import { buildTranscriptMessages } from "./cc-transcript";

// Exposed for bridge-side real-time mirroring (tailing the Claude Code JSONL session file).
export async function resolveSessionFilePath(sessionId: string, cwd?: string): Promise<string | null> {
	return await findSessionFile(sessionId, cwd, CLAUDE_PROJECTS_DIR);
}

export async function listProjects(): Promise<ProjectSummary[]> {
	return await listProjectsFromClaudeDirs({ projectsDir: CLAUDE_PROJECTS_DIR, home: homedir() });
}

export async function listSessions(cwd?: string): Promise<ClaudeCodeSession[]> {
	return await listSessionsFromProjects(cwd, CLAUDE_PROJECTS_DIR);
}

export async function getSession(sessionId: string, cwd?: string): Promise<ClaudeCodeSession | null> {
	const filePath = await findSessionFile(sessionId, cwd, CLAUDE_PROJECTS_DIR);
	if (!filePath) return null;

	const fileStat = await stat(filePath).catch(() => null);
	const preview = await readSessionPreviewCached(filePath);
	const sessionCwd = preview.cwd ?? cwd ?? "";

	const summary = await computeCCSessionStats(filePath);
	return {
		id: sessionId,
		title: preview.title || preview.slug || `Session ${sessionId.slice(0, 8)}`,
		cwd: sessionCwd,
		model: preview.model,
		createdAt: fileStat?.birthtime?.getTime() ?? Date.now(),
		updatedAt: fileStat?.mtime?.getTime() ?? Date.now(),
		isBackground: preview.isBackground,
		hasSubagentActivity: preview.hasSubagentActivity,
		subagentName: preview.subagentName,
		gitBranch: preview.gitBranch,
		...(summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0) ? { summary } : {}),
	};
}

export async function getModifiedFiles(
	sessionId: string,
	cwd?: string,
): Promise<import("../../handlers/session-stats").ModifiedFileEntry[]> {
	const filePath = await findSessionFile(sessionId, cwd, CLAUDE_PROJECTS_DIR);
	if (!filePath) return [];
	const { getCCModifiedFiles } = await import("./cc-session-stats");
	return getCCModifiedFiles(filePath);
}

export async function getSessionMessages(
	sessionId: string,
	cwd?: string,
	limit?: number,
): Promise<ClaudeCodeTranscriptMessage[]> {
	const filePath = await findSessionFile(sessionId, cwd, CLAUDE_PROJECTS_DIR);
	if (!filePath) return [];
	return await buildTranscriptMessages(filePath, limit);
}

export async function deleteSession(sessionId: string, cwd?: string): Promise<boolean> {
	try {
		const { unlink } = await import("node:fs/promises");

		if (cwd) {
			const projectDir = await getProjectSessionsDir(cwd);
			const filePath = join(projectDir, `${sessionId}.jsonl`);
			await unlink(filePath);
			return true;
		}

		const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const filePath = join(CLAUDE_PROJECTS_DIR, entry.name, `${sessionId}.jsonl`);
			try {
				await unlink(filePath);
				return true;
			} catch {}
		}
		return false;
	} catch {
		return false;
	}
}

export async function forkSession(
	sessionId: string,
	messageId?: string,
	cwd?: string,
): Promise<ClaudeCodeSession | null> {
	try {
		// Use SDK forkSession() — properly remaps all message UUIDs and preserves parentUuid chain.
		// Our old implementation used copyFile which left identical UUIDs in both sessions,
		// causing UUID collisions in checkpointing/rewind when both sessions run concurrently.
		const { forkSession: sdkForkSession } = await import("@anthropic-ai/claude-agent-sdk");
		const result = await sdkForkSession(sessionId, {
			...(cwd ? { dir: cwd } : {}),
			...(messageId ? { upToMessageId: messageId } : {}),
		});
		return await getSession(result.sessionId, cwd);
	} catch {
		return null;
	}
}

/**
 * Rename a Claude Code session using SDK's renameSession().
 * SDK appends a custom-title entry to the JSONL file (safe, never mutates existing data).
 * Our old implementation mutated line 0 which could corrupt sessions if the format shifted.
 */
export async function renameSession(sessionId: string, name: string, cwd?: string): Promise<ClaudeCodeSession | null> {
	try {
		const { renameSession: sdkRenameSession } = await import("@anthropic-ai/claude-agent-sdk");
		await sdkRenameSession(sessionId, name, cwd ? { dir: cwd } : undefined);
		return getSession(sessionId, cwd);
	} catch {
		return null;
	}
}
