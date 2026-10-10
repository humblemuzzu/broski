/**
 * Synthetic Claude Code project trees.
 *
 * Fixtures are written under a caller-supplied temp dir (deleted by the caller) so tests and the
 * benchmark can exercise many sessions and a multi-hundred-MB transcript without touching real
 * agent data. Sessions carry the same record shapes as a real transcript: a summary record, meta
 * and command-echo user records, a real first prompt, thinking/text/tool_use assistant records and
 * tool_result records with a structuredPatch.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SyntheticSessionSpec = {
	sessionId: string;
	cwd: string;
	title?: string;
	branch?: string;
	slug?: string;
	/** Extra user/assistant turn pairs appended before the closing turns. */
	turns?: number;
	/** Pad the transcript with filler so it reaches at least this size. */
	targetBytes?: number;
	subagents?: number;
	noTrailingNewline?: boolean;
	crlf?: boolean;
};

export type SyntheticPlan = {
	projects: number;
	sessionsPerProject: number;
	cwdPrefix: string;
	/** Give the first project one session of this size, written last so the tail is real content. */
	largeTranscriptBytes?: number;
	subagentsPerSession?: number;
	turnsPerSession?: number;
	/** Create the cwd directories on disk so preview cwd values resolve to real paths. */
	createCwdDirs?: boolean;
	/** Non-session clutter that the listing must ignore or treat as an orphan subagent dir. */
	orphanSubagentDirs?: number;
};

export type SyntheticProjectsSummary = {
	projectsDir: string;
	sessions: number;
	bytes: number;
	largeTranscriptBytes: number;
	largeTranscriptPath: string | null;
};

export type SyntheticHomePlan = {
	areas: number;
	reposPerArea: number;
	/** Nested directories that hold no `.claude/` but still cost the walk a readdir. */
	fillerDirsPerRepo: number;
	/** Directories with a `.claude/` and no settings file: visited, not emitted. */
	unverifiedPerRepo: number;
};

export type SyntheticHomeSummary = {
	home: string;
	projects: number;
	dirs: number;
};

/** A fake home tree whose shape matches the `~/Documents|StudioProjects|...` scan. */
export async function buildSyntheticHome(home: string, plan: SyntheticHomePlan): Promise<SyntheticHomeSummary> {
	let dirs = 0;
	let projects = 0;
	for (const rootName of ["Documents", "StudioProjects"]) {
		for (let a = 0; a < plan.areas; a++) {
			for (let r = 0; r < plan.reposPerArea; r++) {
				const repo = join(home, rootName, `area-${a}`, `repo-${r}`);
				await mkdir(join(repo, ".claude"), { recursive: true });
				await writeFile(join(repo, ".claude", "settings.local.json"), "{}");
				projects++;
				dirs++;

				for (let f = 0; f < plan.fillerDirsPerRepo; f++) {
					await mkdir(join(repo, "src", `module-${f}`, "nested"), { recursive: true });
					dirs += 3;
				}
				for (let u = 0; u < plan.unverifiedPerRepo; u++) {
					await mkdir(join(repo, `vendor-${u}`, ".claude"), { recursive: true });
					dirs += 2;
				}
			}
		}
	}
	return { home, projects, dirs };
}

const FILLER_BYTES = 4096;

function iso(offsetMs: number): string {
	return new Date(1773000000000 + offsetMs).toISOString();
}

function toolUseResultPayload(filePath: string, lines: number): string {
	const patchLines: string[] = [];
	for (let i = 0; i < lines; i++) {
		patchLines.push(`+added line ${i}`, `-removed line ${i}`);
	}
	return JSON.stringify({
		filePath,
		structuredPatch: [{ oldStart: 1, oldLines: lines, newStart: 1, newLines: lines, lines: patchLines }],
	});
}

type Line = { text: string };

function renderRecords(spec: SyntheticSessionSpec): { head: Line[]; tail: Line[] } {
	const { sessionId, cwd } = spec;
	const title = spec.title ?? `First prompt for ${sessionId}`;
	const branch = spec.branch ?? "main";
	const slug = spec.slug ?? `slug-${sessionId}`;
	const turns = spec.turns ?? 1;
	const record = (value: unknown): Line => ({ text: JSON.stringify(value) });

	const head: Line[] = [
		record({ type: "summary", summary: `Summary for ${sessionId}` }),
		{ text: "" },
		record({
			type: "user",
			uuid: `${sessionId}-meta`,
			timestamp: iso(0),
			cwd,
			message: { role: "user", content: [{ type: "text", text: `meta for ${sessionId}` }] },
			isMeta: true,
		}),
		record({
			type: "user",
			uuid: `${sessionId}-echo`,
			timestamp: iso(1),
			cwd,
			message: { role: "user", content: [{ type: "text", text: `<command-name>/clear</command-name>` }] },
		}),
		record({
			type: "user",
			uuid: `${sessionId}-u0`,
			timestamp: iso(2),
			cwd,
			gitBranch: branch,
			slug,
			message: { role: "user", content: [{ type: "text", text: title }] },
		}),
	];

	const tail: Line[] = [];
	for (let t = 0; t < turns; t++) {
		const toolId = `${sessionId}-tool-${t}`;
		tail.push(
			record({
				type: "assistant",
				uuid: `${sessionId}-a${t}`,
				timestamp: iso(10 + t * 10),
				cwd,
				message: {
					role: "assistant",
					model: t === 0 ? "claude-opus-4-5" : "claude-sonnet-4-5",
					content: [
						{ type: "thinking", thinking: `thinking ${t}` },
						{ type: "text", text: `assistant text ${t}` },
						{ type: "tool_use", id: toolId, name: "Edit", input: { file_path: `${cwd}/file-${t}.ts` } },
					],
				},
			}),
			record({
				type: "user",
				uuid: `${sessionId}-r${t}`,
				timestamp: iso(11 + t * 10),
				cwd,
				message: {
					role: "user",
					content: [{ type: "tool_result", tool_use_id: toolId, content: [{ type: "text", text: `result ${t}` }] }],
				},
				toolUseResult: JSON.parse(toolUseResultPayload(`${cwd}/file-${t}.ts`, 3 + t)),
			}),
			record({
				type: "assistant",
				uuid: `${sessionId}-a${t}-final`,
				timestamp: iso(12 + t * 10),
				cwd,
				message: {
					role: "assistant",
					model: "claude-sonnet-4-5",
					usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1 },
					stop_reason: "end_turn",
					content: [{ type: "text", text: `final text ${t}` }],
				},
			}),
		);
	}

	return { head, tail };
}

function fillerLine(sessionId: string, index: number): Line {
	const payload = "x".repeat(FILLER_BYTES);
	return {
		text: JSON.stringify({
			type: "assistant",
			uuid: `${sessionId}-filler-${index}`,
			timestamp: iso(1000 + index),
			message: { role: "assistant", content: [{ type: "text", text: payload }] },
		}),
	};
}

export async function writeSessionTranscript(filePath: string, spec: SyntheticSessionSpec): Promise<number> {
	const { head, tail } = renderRecords(spec);
	const terminator = spec.noTrailingNewline ? "" : "\n";
	const eol = spec.crlf ? "\r\n" : "\n";
	const target = spec.targetBytes ?? 0;
	const fixed = [...head, ...tail].reduce((sum, line) => sum + Buffer.byteLength(line.text) + 1, 0);

	const sink = Bun.file(filePath).writer();
	let bytes = 0;
	let pending = 0;
	const emit = async (text: string): Promise<void> => {
		bytes += Buffer.byteLength(text);
		sink.write(text);
		if (++pending % 64 === 0) await sink.flush();
	};

	try {
		for (const line of head) await emit(line.text + eol);
		let written = fixed;
		let index = 0;
		const per = FILLER_BYTES + 120;
		while (target > 0 && written + per < target) {
			await emit(fillerLine(spec.sessionId, index++).text + eol);
			written += per;
		}
		for (let i = 0; i < tail.length; i++) {
			const line = tail[i]!;
			await emit(line.text + (i === tail.length - 1 ? terminator : eol));
		}
		await sink.end();
	} catch (err) {
		await sink.end();
		throw err;
	}
	return bytes;
}

async function writeSubagents(projectDir: string, spec: SyntheticSessionSpec): Promise<number> {
	const subagents = spec.subagents ?? 0;
	if (subagents <= 0) return 0;
	const dir = join(projectDir, spec.sessionId, "subagents");
	await mkdir(dir, { recursive: true });
	let bytes = 0;
	for (let i = 0; i < subagents; i++) {
		const agentId = `a${spec.sessionId.replaceAll("-", "").slice(0, 12)}${i}`;
		bytes += await writeSessionTranscript(join(dir, `agent-${agentId}.jsonl`), {
			sessionId: `agent-${agentId}`,
			cwd: spec.cwd,
			title: `subagent prompt ${i}`,
			branch: spec.branch,
		});
		await Bun.write(join(dir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: "general-purpose" }));
	}
	return bytes;
}

export async function buildSyntheticProjects(
	projectsDir: string,
	plan: SyntheticPlan,
): Promise<SyntheticProjectsSummary> {
	await mkdir(projectsDir, { recursive: true });
	let sessions = 0;
	let bytes = 0;
	let largeTranscriptBytes = 0;
	let largeTranscriptPath: string | null = null;

	for (let p = 0; p < plan.projects; p++) {
		const cwd = `${plan.cwdPrefix}/project-${p}`;
		if (plan.createCwdDirs) await mkdir(cwd, { recursive: true });
		const projectDir = join(projectsDir, cwd.replaceAll("/", "-"));
		await mkdir(projectDir, { recursive: true });

		for (let s = 0; s < plan.sessionsPerProject; s++) {
			const sessionId = `10000000-0000-4000-8000-${String(p).padStart(4, "0")}${String(s).padStart(8, "0")}`;
			const isLarge = p === 0 && s === 0 && plan.largeTranscriptBytes !== undefined;
			const targetBytes = isLarge ? plan.largeTranscriptBytes : undefined;
			bytes += await writeSessionTranscript(join(projectDir, `${sessionId}.jsonl`), {
				sessionId,
				cwd,
				title: `First prompt for project ${p} session ${s}`,
				branch: `branch-${p}`,
				turns: plan.turnsPerSession,
				targetBytes,
				subagents: plan.subagentsPerSession,
				noTrailingNewline: s % 7 === 3,
				crlf: s % 5 === 2,
			});
			if (isLarge) {
				largeTranscriptBytes = targetBytes ?? 0;
				largeTranscriptPath = join(projectDir, `${sessionId}.jsonl`);
			}
			sessions++;
			bytes += await writeSubagents(projectDir, {
				sessionId,
				cwd,
				subagents: plan.subagentsPerSession,
			});
		}

		for (let o = 0; o < (plan.orphanSubagentDirs ?? 0); o++) {
			const orphanId = `20000000-0000-4000-8000-${String(p).padStart(4, "0")}${String(o).padStart(8, "0")}`;
			bytes += await writeSubagents(projectDir, { sessionId: orphanId, cwd, subagents: 1 });
		}
		await Bun.write(join(projectDir, "sessions-index.json"), JSON.stringify({ sessions: [] }));
	}

	return { projectsDir, sessions, bytes, largeTranscriptBytes, largeTranscriptPath };
}
