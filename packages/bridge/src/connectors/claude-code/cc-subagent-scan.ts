/**
 * Scans subagents/ directories under Claude Code session directories
 * and adds subagent entries to the session list with proper parent linkage.
 *
 * Extracted from claude-code.ts (frozen file).
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ClaudeCodeSession } from "../../types";

type SessionPreviewReader = (filePath: string) => Promise<{
	cwd?: string;
	model?: string;
	title?: string;
	slug?: string;
	isBackground?: boolean;
	hasSubagentActivity?: boolean;
	subagentName?: string;
	gitBranch?: string;
}>;

/**
 * Scan a subagents/ directory under a session and add subagent sessions to the list.
 * Each subagent entry gets `parentSessionId` set to the owning session's ID.
 */
export async function scanSubagentDir(
	projectDir: string,
	sessionId: string,
	sessionCwd: string,
	filterCwd: string | undefined,
	sessions: (ClaudeCodeSession & { _filePath?: string })[],
	readSessionPreview: SessionPreviewReader,
): Promise<number> {
	const subagentsDir = join(projectDir, sessionId, "subagents");
	let subagentCount = 0;
	try {
		const agentFiles = await readdir(subagentsDir);
		const agentJsonlFiles = agentFiles.filter((f) => f.endsWith(".jsonl") && f.startsWith("agent-"));

		for (const agentFile of agentJsonlFiles) {
			// The Claude Code SDK stores subagents as "agent-<id>.jsonl" but
			// its internal lookup uses the <id> portion only — see
			// `getSubagentMessages()` in @anthropic-ai/claude-agent-sdk
			// where it does `name.slice(6, -6)` to strip both "agent-" prefix
			// and ".jsonl" suffix before matching. We MUST store the stripped
			// id here so `ccGetSubagentMessages(sessionId, id)` can find it.
			const fullName = basename(agentFile, ".jsonl"); // "agent-abc123"
			const agentId = fullName.startsWith("agent-") ? fullName.slice(6) : fullName;
			// Guard against pathological filenames like "agent-.jsonl" that
			// would produce an empty agentId (the SDK lookup wouldn't match
			// either). Skip them entirely.
			if (!agentId) continue;
			const agentPath = join(subagentsDir, agentFile);
			try {
				const agentStat = await stat(agentPath);
				const agentPreview = await readSessionPreview(agentPath);
				const agentTitle = agentPreview.title || agentPreview.slug || `${agentId.slice(0, 12)}`;

				sessions.push({
					id: agentId,
					title: agentTitle,
					cwd: sessionCwd || filterCwd || "",
					model: agentPreview.model,
					createdAt: agentStat.birthtime.getTime(),
					updatedAt: agentStat.mtime.getTime(),
					isBackground: true,
					hasSubagentActivity: false,
					subagentName: agentPreview.subagentName,
					parentSessionId: sessionId,
					gitBranch: agentPreview.gitBranch,
				} as ClaudeCodeSession);
				subagentCount++;
			} catch {
				// skip individual agent files that fail
			}
		}
	} catch {
		// subagents/ dir doesn't exist or can't be read
	}
	return subagentCount;
}
