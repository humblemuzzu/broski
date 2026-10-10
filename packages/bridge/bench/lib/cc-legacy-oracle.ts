/**
 * The pre-optimisation session listing, kept verbatim in behaviour so parity tests and the
 * real-data benchmark can diff new against old on the same fixtures: 200 KB slice previews,
 * whole-file stats scans and an unbounded `Promise.all` over every session.
 *
 * The small line parsers are imported from the extracted module because they were moved without a
 * behaviour change; only the read strategy differs here.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { getProjectSessionsDir } from "../../src/connectors/claude-code/cc-paths";
import { scanSubagentDir } from "../../src/connectors/claude-code/cc-subagent-scan";
import {
	extractFirstTextContent,
	isLikelyCommandEcho,
	safeParseJsonLine,
	type TranscriptContentBlock,
} from "../../src/connectors/claude-code/cc-transcript-parse";
import { aggregateFileDiffs } from "../../src/handlers/session-stats";
import type { ClaudeCodeSession } from "../../src/types";

export type LegacyPreview = {
	cwd?: string;
	model?: string;
	title?: string;
	slug?: string;
	isBackground?: boolean;
	hasSubagentActivity?: boolean;
	subagentName?: string;
	gitBranch?: string;
};

export async function legacyReadSessionPreview(filePath: string, maxBytes: number = 200_000): Promise<LegacyPreview> {
	try {
		const preview = await Bun.file(filePath).slice(0, maxBytes).text();
		const lines = preview.split("\n").filter(Boolean);

		let cwd: string | undefined;
		let model: string | undefined;
		let title: string | undefined;
		let slug: string | undefined;
		let isBackground = false;
		let hasSubagentActivity = false;
		let subagentName: string | undefined;
		let gitBranch: string | undefined;

		for (const line of lines) {
			const parsed = safeParseJsonLine(line);
			if (!parsed) continue;
			if (!cwd && typeof parsed.cwd === "string") cwd = parsed.cwd;
			if (!gitBranch && typeof parsed.gitBranch === "string") gitBranch = parsed.gitBranch;
			if (!slug && typeof parsed.slug === "string") slug = parsed.slug;
			if (!model && typeof parsed.message?.model === "string") model = parsed.message.model;

			const parentToolUseId = parsed.parent_tool_use_id;
			if (parentToolUseId && parentToolUseId.length > 0) {
				isBackground = true;
			}

			const content = parsed.message?.content;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (!block || typeof block !== "object") continue;
					const b = block as TranscriptContentBlock;
					if (b.type !== "tool_use") continue;
					const toolName = b.name;
					if (toolName !== "Task") continue;
					const toolInput = b.input as Record<string, unknown> | undefined;
					const rawSubagent = toolInput?.subagent_type;
					const taskSubagent = typeof rawSubagent === "string" ? rawSubagent.trim() : "";
					if (taskSubagent.length > 0) {
						hasSubagentActivity = true;
						if (!subagentName) subagentName = taskSubagent;
					}
				}
			}

			if (!title && parsed.type === "user" && parsed.message?.role === "user" && parsed.isMeta !== true) {
				const maybeText = extractFirstTextContent(parsed.message?.content);
				if (maybeText && !isLikelyCommandEcho(maybeText)) {
					title = maybeText
						.trim()
						.split("\n")
						.find((l) => l.trim().length > 0)
						?.trim();
				}
			}
		}

		if (title && title.length > 80) title = `${title.slice(0, 77)}…`;

		const titleHint = (title || "").toLowerCase();
		if (!isBackground) {
			isBackground = titleHint.includes("subagent") || titleHint.includes("@agent") || titleHint.includes("background");
		}

		return { cwd, model, title, slug, isBackground, hasSubagentActivity, subagentName, gitBranch };
	} catch {
		return {};
	}
}

async function legacyScanCCFileDiffs(
	filePath: string,
): Promise<Array<{ file: string; additions: number; deletions: number }>> {
	const text = await Bun.file(filePath).text();
	const lines = text.split("\n");
	const fileDiffs: Array<{ file: string; additions: number; deletions: number }> = [];

	for (const line of lines) {
		if (!line) continue;
		if (!line.includes("toolUseResult")) continue;

		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		const toolUseResult = parsed?.toolUseResult;
		if (!toolUseResult || typeof toolUseResult !== "object") continue;

		const resultFilePath = toolUseResult.filePath as string | undefined;
		if (!resultFilePath) continue;

		const structuredPatch = toolUseResult.structuredPatch;
		if (Array.isArray(structuredPatch) && structuredPatch.length > 0) {
			let additions = 0;
			let deletions = 0;
			for (const hunk of structuredPatch) {
				const hunkLines = Array.isArray(hunk?.lines) ? hunk.lines : [];
				for (const l of hunkLines) {
					if (typeof l !== "string") continue;
					if (l.startsWith("+") && !l.startsWith("+++")) additions++;
					if (l.startsWith("-") && !l.startsWith("---")) deletions++;
				}
			}
			if (additions > 0 || deletions > 0) {
				fileDiffs.push({ file: resultFilePath, additions, deletions });
				continue;
			}
		}

		const oldStr = typeof toolUseResult.oldString === "string" ? toolUseResult.oldString : "";
		const newStr = typeof toolUseResult.newString === "string" ? toolUseResult.newString : "";
		if (oldStr || newStr) {
			const oldLines = oldStr ? oldStr.split("\n").length : 0;
			const newLines = newStr ? newStr.split("\n").length : 0;
			const additions = Math.max(0, newLines - oldLines);
			const deletions = Math.max(0, oldLines - newLines);
			if (additions > 0 || deletions > 0) {
				fileDiffs.push({ file: resultFilePath, additions, deletions });
			}
		}
	}

	return fileDiffs;
}

export async function legacyComputeCCSessionStats(filePath: string) {
	try {
		await stat(filePath);
		return aggregateFileDiffs(await legacyScanCCFileDiffs(filePath));
	} catch {
		return null;
	}
}

export async function legacyListSessions(cwd: string | undefined, projectsDir: string): Promise<ClaudeCodeSession[]> {
	const sessions: (ClaudeCodeSession & { _filePath?: string })[] = [];

	try {
		let projectDirs: string[] = [];

		if (cwd) {
			const projectDir = await getProjectSessionsDir(cwd, projectsDir);
			try {
				await stat(projectDir);
				projectDirs = [projectDir];
			} catch {
				return [];
			}
		} else {
			try {
				const entries = await readdir(projectsDir, { withFileTypes: true });
				projectDirs = entries.filter((e) => e.isDirectory()).map((e) => join(projectsDir, e.name));
			} catch {
				return [];
			}
		}

		for (const projectDir of projectDirs) {
			try {
				const files = await readdir(projectDir);
				const sessionFiles = files.filter((f) => f.endsWith(".jsonl"));
				const sessionIdsWithJsonl = new Set(sessionFiles.map((f) => basename(f, ".jsonl")));

				for (const file of sessionFiles) {
					const sessionId = basename(file, ".jsonl");
					const filePath = join(projectDir, file);
					const fileStat = await stat(filePath);

					const preview = await legacyReadSessionPreview(filePath);
					const sessionCwd = preview.cwd ?? cwd ?? "";

					if (cwd && sessionCwd && sessionCwd !== cwd) {
						continue;
					}

					const derivedTitle =
						preview.title ||
						preview.slug ||
						(sessionCwd ? `${basename(sessionCwd)} • ${sessionId.slice(0, 8)}` : undefined);

					sessions.push({
						id: sessionId,
						title: derivedTitle || `Session ${sessionId.slice(0, 8)}`,
						cwd: sessionCwd || cwd || "",
						model: preview.model,
						createdAt: fileStat.birthtime.getTime(),
						updatedAt: fileStat.mtime.getTime(),
						isBackground: preview.isBackground,
						hasSubagentActivity: preview.hasSubagentActivity,
						subagentName: preview.subagentName,
						gitBranch: preview.gitBranch,
						_filePath: filePath,
					});

					const subagentCount = await scanSubagentDir(
						projectDir,
						sessionId,
						sessionCwd,
						cwd,
						sessions,
						legacyReadSessionPreview,
					);

					if (subagentCount > 0) {
						const parentSession = sessions.find((s) => s.id === sessionId && s._filePath === filePath);
						if (parentSession) {
							parentSession.subagentCount = subagentCount;
						}
					}
				}

				const allDirs = files.filter((f) => !f.endsWith(".jsonl") && !f.endsWith("index.json") && !f.endsWith(".json"));
				for (const dirName of allDirs) {
					if (sessionIdsWithJsonl.has(dirName)) continue;
					await scanSubagentDir(projectDir, dirName, cwd ?? "", cwd, sessions, legacyReadSessionPreview);
				}
			} catch {}
		}

		sessions.sort((a, b) => b.updatedAt - a.updatedAt);

		await Promise.all(
			sessions.map(async (session) => {
				const fp = session._filePath;
				if (!fp) return;
				const summary = await legacyComputeCCSessionStats(fp);
				if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
					session.summary = summary;
				}
				delete session._filePath;
			}),
		);

		return sessions;
	} catch {
		return [];
	}
}
