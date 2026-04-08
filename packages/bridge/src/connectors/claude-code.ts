import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { scanSubagentDir } from "./claude-code/cc-subagent-scan";
import type {
	ElicitationRequest,
	ElicitationResult,
	Options,
	McpServerStatus as SDKMcpServerStatus,
	Query as SDKQuery,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
	ClaudeCodeAccountInfo,
	ClaudeCodeBeta,
	ClaudeCodeCommand,
	ClaudeCodeConfig,
	ClaudeCodeEffort,
	ClaudeCodeHook,
	ClaudeCodeHookEvent,
	ClaudeCodeMcpServerStatus,
	ClaudeCodeOutputFormat,
	ClaudeCodePermissionMode,
	ClaudeCodeSandboxSettings,
	ClaudeCodeSession,
	ClaudeCodeSkill,
	ClaudeCodeStreamMessage,
	ClaudeCodeSubagent,
	ClaudeCodeSupportedModel,
	ClaudeCodeThinkingOption,
	ClaudeCodeTranscriptMessage,
	FileAttachment,
	PermissionResponse,
	ProjectSummary,
} from "../types";
import { computeCCSessionStats } from "./claude-code/cc-session-stats";
import { normalizeSupportedModels } from "./claude-code/model-normalization";
import { emitClaudeCodeSupplementalStreamEvents } from "./claude-code/stream-supplemental-events";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const CLAUDE_SETTINGS_FILE = join(homedir(), ".claude", "settings.json");
const BROSKI_DIR = join(homedir(), ".broski");
const CC_CONFIG_FILE = join(BROSKI_DIR, "claude-code-config.json");

/**
 * Classify a .claude/ subdirectory as 'project' or 'user' scope.
 *
 * The old check `dir.startsWith(homedir())` was wrong because *every* path on
 * macOS/Linux starts with the home directory — even project paths.
 *
 * The correct logic: a directory is 'user' scoped if and only if it lives
 * directly under `~/.claude/<feature>/` (the user-level config root).
 * Everything else (including `<project>/.claude/<feature>/`) is 'project'.
 */
function classifySource(dir: string, feature: string): "project" | "user" {
	const userDir = join(homedir(), ".claude", feature);
	// Exact match or direct child — this IS the user-scope directory.
	return dir === userDir ? "user" : "project";
}

type ActiveSession = {
	controller: AbortController;
	cwd: string;
	query?: SDKQuery;
	startedAt: number;
};

const activeSessions = new Map<string, ActiveSession>();
const ccSupportedModelsByCwd = new Map<string, ClaudeCodeSupportedModel[]>();
const ccAccountInfoByCwd = new Map<string, ClaudeCodeAccountInfo>();
const ccMcpStatusByCwd = new Map<string, ClaudeCodeMcpServerStatus[]>();

let currentConfig: ClaudeCodeConfig = {
	permissionMode: "default",
	allowedTools: [
		"Read",
		"Glob",
		"Grep",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"TodoWrite",
		"Write",
		"Edit",
		"MultiEdit",
		"Bash",
		"NotebookEdit",
		"Task",
	],
	disallowedTools: [],
	model: "sonnet",
	betas: [],
	enableAgentTeams: false,
	promptSuggestions: false,
	systemPrompt: { type: "preset", preset: "claude_code" },
	// Defaults: Claude Code itself defaults to respecting .gitignore in file pickers.
	// Leave language/releaseChannel unset unless the user configures them.
	respectGitignore: true,
};

// Best-effort persisted config load (keeps Claude Code settings stable across bridge restarts).
try {
	if (existsSync(CC_CONFIG_FILE)) {
		const raw = readFileSync(CC_CONFIG_FILE, "utf-8");
		const parsed = JSON.parse(raw) as Partial<ClaudeCodeConfig>;
		currentConfig = {
			...currentConfig,
			...parsed,
			...(parsed.betas ? { betas: normalizeBetas(parsed.betas) } : {}),
		};
	}
} catch {
	// ignore (use defaults)
}

async function persistConfig(): Promise<void> {
	try {
		await mkdir(BROSKI_DIR, { recursive: true });
		await writeFile(CC_CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
	} catch (err) {
		console.warn("[Claude Code] Failed to persist config:", err);
	}
}

async function readProjectSettings(cwd: string): Promise<Record<string, any>> {
	const settingsPath = join(cwd, ".claude", "settings.json");
	try {
		const raw = await readFile(settingsPath, "utf-8");
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
	} catch {
		return {};
	}
}

async function writeProjectSettings(cwd: string, next: Record<string, any>): Promise<void> {
	const settingsPath = join(cwd, ".claude", "settings.json");
	await mkdir(join(cwd, ".claude"), { recursive: true });
	await writeFile(settingsPath, JSON.stringify(next, null, 2), "utf-8");
}

function applyProjectSettingsPatch(
	settings: Record<string, any>,
	patch: Pick<ClaudeCodeConfig, "language" | "releaseChannel" | "respectGitignore">,
): Record<string, any> {
	const next = { ...settings };

	if ("language" in patch) {
		const v = patch.language;
		if (typeof v === "string" && v.trim().length > 0) next.language = v.trim();
		else delete next.language;
	}

	if ("releaseChannel" in patch) {
		const v = patch.releaseChannel;
		if (v === "stable" || v === "latest") next.releaseChannel = v;
		else delete next.releaseChannel;
	}

	if ("respectGitignore" in patch) {
		const v = patch.respectGitignore;
		if (typeof v === "boolean") next.respectGitignore = v;
		else delete next.respectGitignore;
	}

	return next;
}

function cwdCacheKey(cwd?: string): string {
	const normalized = (cwd || "").trim();
	return normalized.length > 0 ? normalized : "__global__";
}

function normalizeBetas(betas?: string[] | ClaudeCodeBeta[]): ClaudeCodeBeta[] | undefined {
	if (!Array.isArray(betas)) return undefined;
	const normalized = Array.from(
		new Set(betas.map((b) => String(b).trim()).filter((b): b is ClaudeCodeBeta => b === "context-1m-2025-08-07")),
	);
	return normalized.length > 0 ? normalized : undefined;
}

function fallbackSupportedModels(): ClaudeCodeSupportedModel[] {
	return [
		{
			value: "sonnet",
			displayName: "Claude Sonnet",
			description: "Balanced model for coding and reasoning",
		},
		{
			value: "opus",
			displayName: "Claude Opus",
			description: "High-capability model for complex tasks",
		},
		{
			value: "haiku",
			displayName: "Claude Haiku",
			description: "Fast and efficient model for lightweight tasks",
		},
	];
}

function _sanitizeFilename(name: string): string {
	const base = basename(name || "attachment");
	return base.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function _extForMime(mimeType?: string | null): string {
	const mt = (mimeType || "").toLowerCase();
	if (mt === "image/png") return ".png";
	if (mt === "image/jpeg") return ".jpg";
	if (mt === "image/jpg") return ".jpg";
	if (mt === "image/webp") return ".webp";
	if (mt === "image/gif") return ".gif";
	if (mt === "image/bmp") return ".bmp";
	if (mt === "image/tiff") return ".tiff";
	return "";
}

async function _writeImageAttachmentToDisk(cwd: string, attachment: FileAttachment): Promise<string | null> {
	const base64Data = attachment.base64Data;
	if (!base64Data) return null;

	const attachmentsDir = join(cwd, ".broski", "cc-attachments");
	await mkdir(attachmentsDir, { recursive: true });

	const ext =
		_extForMime(attachment.mimeType) || (_sanitizeFilename(attachment.path).match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".jpg");
	const safeName = _sanitizeFilename(attachment.path || "image");
	const token = randomBytes(6).toString("hex");
	const fileName = safeName.includes(".") ? safeName : `${safeName}${ext}`;
	const outPath = join(attachmentsDir, `${Date.now()}_${token}_${fileName}`);

	const bytes = Buffer.from(base64Data, "base64");
	await writeFile(outPath, bytes);
	return outPath;
}

/**
 * Claude Code SDK doesn't have a first-class "attachments" parameter like OpenCode.
 * To support Broski's attachment UX, we:
 * - Pass file paths as explicit references in the prompt (Claude can Read them)
 * - Persist mobile-picked images to disk under the session cwd and reference them
 */
export async function preparePromptWithAttachments(
	prompt: string,
	cwd: string,
	fileAttachments?: FileAttachment[],
): Promise<string> {
	if (!fileAttachments || fileAttachments.length === 0) return prompt;

	const lines: string[] = [];

	for (const a of fileAttachments) {
		if (a.base64Data) {
			const savedPath = await _writeImageAttachmentToDisk(cwd, a);
			if (savedPath) {
				lines.push(`- Image: @${savedPath}`);
			}
			continue;
		}

		if (!a.path) continue;
		const prefix = a.isDirectory ? "Directory" : "File";
		const ref = a.path.startsWith("@") ? a.path : `@${a.path}`;
		lines.push(`- ${prefix}: ${ref}`);
	}

	if (lines.length === 0) return prompt;

	return [
		prompt,
		"",
		"---",
		"Attached context (via Broski):",
		...lines,
		"",
		"If relevant, use the Read tool on the @paths above.",
	].join("\n");
}

export type ClaudeCodeQueryOptions = {
	cwd: string;
	sessionId?: string;
	model?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	permissionMode?: ClaudeCodePermissionMode;
	maxThinkingTokens?: number | null;
	maxTurns?: number;
	maxBudgetUsd?: number;
	betas?: ClaudeCodeBeta[];
	variant?: string; // Named thinking level (low/medium/high/max) - maps to maxThinkingTokens (DEPRECATED)
	thinking?: ClaudeCodeThinkingOption; // New structured thinking option (SDK 0.2.42+)
	effort?: ClaudeCodeEffort; // Effort level (SDK 0.2.42+)
	agent?: string; // Top-level agent name (SDK 0.2.42+)
	systemPrompt?: string | { type: "preset"; preset: string; append?: string } | null;
	resumeSessionAt?: string;
	outputFormat?: ClaudeCodeOutputFormat;
	sandbox?: ClaudeCodeSandboxSettings;
	enableAgentTeams?: boolean;
	enableFileCheckpointing?: boolean;
	persistSession?: boolean;
	promptSuggestions?: boolean;
	enableClaudeAiMcpServers?: boolean;
	agents?: Record<string, ClaudeCodeSubagent>; // Custom subagent definitions
	activeSubagent?: string; // Name of the subagent to use for this query (prepends prompt hint)
	fallbackModel?: string; // B5: fallback model on primary failure
	additionalDirectories?: string[]; // B6: extra directories agent can access
	agentProgressSummaries?: boolean; // SDK 0.2.74: AI-generated progress summaries for subagents
	continueSession?: boolean; // SDK 0.2.87: Continue most recent conversation in cwd
	forkOnResume?: boolean; // SDK 0.2.87: Fork to new session ID when resuming
};

/**
 * Thinking level variants mapped to maxThinkingTokens values.
 * These provide user-friendly named presets for Claude's extended thinking feature.
 * Values chosen to match typical reasoning effort levels.
 */
const THINKING_VARIANTS: Record<string, number | null> = {
	default: null, // Use SDK default (no override)
	low: 4096, // Quick responses, minimal reasoning
	medium: 16384, // Balanced reasoning
	high: 65536, // Deep reasoning for complex tasks
	max: null, // Use model maximum (SDK default handles this)
};

/**
 * Convert a named variant to maxThinkingTokens value.
 * Returns undefined if variant is not recognized (allowing fallback to explicit maxThinkingTokens).
 */
function variantToThinkingTokens(variant?: string): number | null | undefined {
	if (!variant) return undefined;
	const normalized = variant.toLowerCase();
	if (normalized in THINKING_VARIANTS) {
		return THINKING_VARIANTS[normalized];
	}
	return undefined;
}

/**
 * Claude Code stores per-project sessions under `~/.claude/projects/<projectKey>/`.
 * On macOS/Linux this is typically the absolute path with separators replaced by `-`,
 * e.g. `/Users/me/repo` -> `-Users-me-repo`.
 *
 * This encoding is not strictly reversible (paths can contain `-`), so we treat it
 * as a best-effort hint and fall back to scanning.
 */
function encodeProjectPath(path: string): string {
	// Normalize Windows backslashes to forward slashes for consistent encoding.
	// Claude Code encodes `/Users/me/repo` as `-Users-me-repo`.
	// On Windows, `C:\Users\me\repo` → `C:/Users/me/repo` → `-C:-Users-me-repo`.
	// Claude Code also replaces spaces with dashes:
	//   `/Users/me/Code stuff/repo` → `-Users-me-Code-stuff-repo`
	const normalized = path.replaceAll("\\", "/");
	return normalized.replaceAll("/", "-").replaceAll(" ", "-");
}

/**
 * Reverse-decode a project directory name back to a real filesystem path.
 *
 * The encoding replaces both `/` and ` ` with `-`, making it lossy.
 * We reconstruct the path greedily: starting from `/`, at each `-` boundary
 * we try treating it as a directory separator first, then as a space, then as
 * a literal dash.  We pick the interpretation where the directory actually
 * exists on disk.  If nothing matches, we give up and return null.
 */
async function decodeProjectDirName(dirName: string): Promise<string | null> {
	// Strip the leading dash that represents the root `/`
	if (!dirName.startsWith("-")) return null;
	const rest = dirName.slice(1);
	if (!rest) return "/";

	const segments = rest.split("-");
	if (segments.length === 0) return null;

	// Greedy path reconstruction with filesystem verification
	async function resolve(idx: number, current: string): Promise<string | null> {
		if (idx >= segments.length) {
			// All segments consumed – verify the full path exists
			return (await existsDir(current)) ? current : null;
		}

		// Try building the next path component by joining successive segments
		// with spaces first (longer match = fewer ambiguous decisions).
		// For each candidate, recurse.
		for (let end = segments.length; end > idx; end--) {
			const component = segments.slice(idx, end).join(" ");
			const candidateSep = `${current}/${component}`;
			if (await existsDir(candidateSep)) {
				if (end >= segments.length) return candidateSep;
				const deeper = await resolve(end, candidateSep);
				if (deeper) return deeper;
			}
		}

		// Also try joining with dashes (literal dashes in the original name)
		for (let end = segments.length; end > idx + 1; end--) {
			const component = segments.slice(idx, end).join("-");
			const candidateSep = `${current}/${component}`;
			if (await existsDir(candidateSep)) {
				if (end >= segments.length) return candidateSep;
				const deeper = await resolve(end, candidateSep);
				if (deeper) return deeper;
			}
		}

		return null;
	}

	return resolve(0, "");
}

async function existsDir(path: string): Promise<boolean> {
	try {
		const st = await stat(path);
		return st.isDirectory();
	} catch {
		return false;
	}
}

async function getProjectSessionsDir(cwd: string): Promise<string> {
	const encoded = encodeProjectPath(cwd);
	const direct = join(CLAUDE_PROJECTS_DIR, encoded);
	if (await existsDir(direct)) return direct;

	// Fallback: scan and pick the directory with a name suffix match to reduce collisions.
	// Match both the space-aware encoding AND any trailing segment.
	const base = encoded.replaceAll(/^-+/, "");
	try {
		const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
		const candidates = entries
			.filter((e) => e.isDirectory())
			.map((e) => join(CLAUDE_PROJECTS_DIR, e.name))
			.filter((p) => {
				const name = basename(p);
				// Direct suffix match
				if (name.endsWith(base)) return true;
				// Normalize both sides: collapse spaces and dashes for comparison
				const normName = name.toLowerCase();
				const normBase = base.toLowerCase();
				return normName.endsWith(normBase);
			});
		if (candidates.length > 0) return candidates[0] ?? direct;
	} catch {
		// ignore
	}

	return direct;
}

type ClaudeTranscriptLine = {
	type?: string;
	sessionId?: string;
	session_id?: string;
	uuid?: string;
	timestamp?: string;
	cwd?: string;
	gitBranch?: string;
	slug?: string;
	isMeta?: boolean;
	parent_tool_use_id?: string;
	toolUseResult?: unknown;
	message?: {
		role?: string;
		content?: unknown;
		model?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
};

/** Content block shape from Claude Code JSONL transcripts (parsed from JSON). */
type TranscriptContentBlock = {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: unknown;
};

function safeParseJsonLine(line: string): any | null {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

function isLikelyCommandEcho(text: string): boolean {
	const t = text.trim();
	if (t.startsWith("<command-name>")) return true;
	if (t.startsWith("<local-command-")) return true;
	if (t.startsWith("<command-message>")) return true;
	if (t.startsWith("<command-args>")) return true;
	if (t.startsWith("<local-command-stdout>")) return true;
	if (t.startsWith("<local-command-stderr>")) return true;
	return false;
}

function extractFirstTextContent(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (block && typeof block === "object") {
				const b = block as TranscriptContentBlock;
				if (b.type === "text" && typeof b.text === "string") {
					return b.text;
				}
			}
		}
	}
	return null;
}

function isoToMs(ts?: string): number {
	if (!ts) return Date.now();
	const parsed = Date.parse(ts);
	return Number.isFinite(parsed) ? parsed : Date.now();
}

function toolResultToText(result: unknown): string {
	if (result == null) return "";
	if (typeof result === "string") return result;
	if (Array.isArray(result)) {
		const parts: string[] = [];
		for (const item of result) {
			if (item && typeof item === "object") {
				const b = item as TranscriptContentBlock;
				if (b.type === "text" && typeof b.text === "string") {
					parts.push(b.text);
				} else if (typeof b.text === "string") {
					parts.push(b.text);
				} else {
					parts.push(JSON.stringify(item));
				}
			} else if (typeof item === "string") {
				parts.push(item);
			}
		}
		return parts.join("\n").trim();
	}
	try {
		return JSON.stringify(result);
	} catch {
		return String(result);
	}
}

function structuredPatchToUnifiedDiff(
	filePath: string,
	patches: any[],
): { diff: string; additions: number; deletions: number } | null {
	if (!Array.isArray(patches) || patches.length === 0) return null;
	const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
	let additions = 0;
	let deletions = 0;
	let body = "";

	for (const hunk of patches) {
		const oldStart = Number(hunk?.oldStart ?? 0);
		const oldLines = Number(hunk?.oldLines ?? 0);
		const newStart = Number(hunk?.newStart ?? 0);
		const newLines = Number(hunk?.newLines ?? 0);
		const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];
		body += `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@\n`;
		for (const line of lines) {
			if (typeof line !== "string") continue;
			if (line.startsWith("+") && !line.startsWith("+++")) additions++;
			if (line.startsWith("-") && !line.startsWith("---")) deletions++;
			body += `${line}\n`;
		}
	}

	return { diff: header + body, additions, deletions };
}

function toolUseResultToDiff(
	toolUseResult: any,
): { diff?: string; before: string; after: string; file: string; additions: number; deletions: number } | null {
	if (!toolUseResult || typeof toolUseResult !== "object") return null;
	const filePath = toolUseResult.filePath as string | undefined;
	if (!filePath) return null;

	// If Claude Code provides structuredPatch, prefer a unified diff.
	const structuredPatch = toolUseResult.structuredPatch;
	const patchDiff = structuredPatchToUnifiedDiff(filePath, structuredPatch);
	if (patchDiff) {
		return {
			file: filePath,
			before: "",
			after: "",
			diff: patchDiff.diff,
			additions: patchDiff.additions,
			deletions: patchDiff.deletions,
		};
	}

	// Fallback: best-effort from old/new string snippets.
	const before =
		typeof toolUseResult.oldString === "string"
			? toolUseResult.oldString
			: typeof toolUseResult.originalFile === "string"
				? toolUseResult.originalFile
				: "";
	const after =
		typeof toolUseResult.newString === "string"
			? toolUseResult.newString
			: typeof toolUseResult.content === "string"
				? toolUseResult.content
				: "";
	return {
		file: filePath,
		before,
		after,
		additions: 0,
		deletions: 0,
	};
}

async function readSessionPreview(
	filePath: string,
	maxBytes: number = 200_000,
): Promise<{
	cwd?: string;
	model?: string;
	title?: string;
	slug?: string;
	isBackground?: boolean;
	hasSubagentActivity?: boolean;
	subagentName?: string;
	gitBranch?: string;
}> {
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
			const parsed = safeParseJsonLine(line) as ClaudeTranscriptLine | null;
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

async function findSessionFile(sessionId: string, cwd?: string): Promise<string | null> {
	const filename = `${sessionId}.jsonl`;

	if (cwd) {
		const projectDir = await getProjectSessionsDir(cwd);
		const candidate = join(projectDir, filename);
		try {
			await stat(candidate);
			return candidate;
		} catch {
			// fall back to scan
		}
	}

	try {
		const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const candidate = join(CLAUDE_PROJECTS_DIR, entry.name, filename);
			try {
				await stat(candidate);
				return candidate;
			} catch {}
		}
	} catch {
		// ignore
	}

	return null;
}

// Exposed for bridge-side real-time mirroring (tailing the Claude Code JSONL session file).
export async function resolveSessionFilePath(sessionId: string, cwd?: string): Promise<string | null> {
	return await findSessionFile(sessionId, cwd);
}

export async function listProjects(): Promise<ProjectSummary[]> {
	const seenPaths = new Set<string>();
	const projects: ProjectSummary[] = [];

	// ── Source 1: ~/.claude/projects/ (central session store) ──────────────
	try {
		const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const dirPath = join(CLAUDE_PROJECTS_DIR, entry.name);
			const dirSt = await stat(dirPath).catch(() => null);

			// Best-effort: use the most recently modified session file to infer cwd.
			let latestFile: { path: string; mtime: number } | null = null;
			try {
				const files = await readdir(dirPath);
				for (const f of files) {
					if (!f.endsWith(".jsonl")) continue;
					const fp = join(dirPath, f);
					const st = await stat(fp).catch(() => null);
					if (!st) continue;
					const mtime = st.mtime.getTime();
					if (!latestFile || mtime > latestFile.mtime) {
						latestFile = { path: fp, mtime };
					}
				}
			} catch {
				// ignore
			}

			const preview = latestFile ? await readSessionPreview(latestFile.path) : {};
			let cwd = preview.cwd;

			// If no .jsonl files or no cwd in preview, decode the directory name
			// back to a real filesystem path.
			if (!cwd) {
				cwd = (await decodeProjectDirName(entry.name)) ?? undefined;
			}

			if (!cwd) continue;
			if (seenPaths.has(cwd)) continue;
			seenPaths.add(cwd);

			projects.push({
				id: cwd,
				name: basename(cwd) || cwd,
				path: cwd,
				lastOpened: latestFile?.mtime ?? dirSt?.mtime?.getTime(),
			});
		}
	} catch {
		// ignore – projects dir may not exist yet
	}

	// ── Source 2: scan common directories for local .claude/ folders ───────
	// Projects where Claude was initialized but may not have centrally-stored sessions.
	const home = homedir();
	const scanRoots = [
		join(home, "Documents"),
		join(home, "StudioProjects"),
		join(home, "Desktop"),
		join(home, "Projects"),
		join(home, "Developer"),
		join(home, "repos"),
		join(home, "src"),
		join(home, "code"),
		join(home, "Code"),
		join(home, "workspace"),
		join(home, "dev"),
	];

	for (const root of scanRoots) {
		try {
			await discoverClaudeProjects(root, 0, 5, seenPaths, projects);
		} catch {
			// root doesn't exist or isn't readable – skip
		}
	}

	// Most recently touched first
	projects.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
	return projects;
}

/**
 * Recursively scan a directory tree for folders containing `.claude/` with
 * `settings.local.json` or a sibling `CLAUDE.md` — indicators that Claude
 * Code was used in that project.  Skips node_modules, .git, etc.
 */
async function discoverClaudeProjects(
	dir: string,
	depth: number,
	maxDepth: number,
	seen: Set<string>,
	out: ProjectSummary[],
): Promise<void> {
	if (depth > maxDepth) return;

	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	// Skip uninteresting directories
	const dirBase = basename(dir);
	if (["node_modules", ".git", ".svn", "build", "dist", ".cache", ".Trash"].includes(dirBase)) return;

	// Check if THIS directory has a .claude/ folder
	const hasClaudeDir = entries.some((e) => e.isDirectory() && e.name === ".claude");
	if (hasClaudeDir && !seen.has(dir)) {
		// Verify the user actually ran Claude here by checking for local settings
		// (settings.local.json is created by Claude Code when the user runs it).
		// CLAUDE.md alone doesn't count — cloned repos may include it.
		const claudeDir = join(dir, ".claude");
		const isRealProject = await Promise.all([
			stat(join(claudeDir, "settings.local.json")).catch(() => null),
			stat(join(claudeDir, "settings.json")).catch(() => null),
		]).then(([a, b]) => a || b);

		if (isRealProject) {
			seen.add(dir);
			const claudeSt = await stat(claudeDir).catch(() => null);
			out.push({
				id: dir,
				name: basename(dir),
				path: dir,
				lastOpened: claudeSt?.mtime?.getTime(),
			});
		}
	}

	// Recurse into subdirectories
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
		if (["node_modules", ".git", ".svn", "build", "dist", ".cache", ".Trash"].includes(entry.name)) continue;
		await discoverClaudeProjects(join(dir, entry.name), depth + 1, maxDepth, seen, out);
	}
}

export async function listSessions(cwd?: string): Promise<ClaudeCodeSession[]> {
	const sessions: (ClaudeCodeSession & { _filePath?: string })[] = [];

	try {
		let projectDirs: string[] = [];

		if (cwd) {
			const projectDir = await getProjectSessionsDir(cwd);
			try {
				await stat(projectDir);
				projectDirs = [projectDir];
			} catch {
				return [];
			}
		} else {
			try {
				const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
				projectDirs = entries.filter((e) => e.isDirectory()).map((e) => join(CLAUDE_PROJECTS_DIR, e.name));
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

					const preview = await readSessionPreview(filePath);
					const sessionCwd = preview.cwd ?? cwd ?? "";

					// Filter if caller requested a specific cwd but directory encoding collided.
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
						_filePath: filePath, // internal: used for stats computation below
					} as ClaudeCodeSession & { _filePath: string });

					// Scan subagents/ subdirectory for subagent session files
					const subagentCount = await scanSubagentDir(projectDir, sessionId, sessionCwd, cwd, sessions, readSessionPreview);

					// Annotate parent session with subagent count
					if (subagentCount > 0) {
						const parentSession = sessions.find(
							(s) => s.id === sessionId && (s as any)._filePath === filePath,
						);
						if (parentSession) {
							(parentSession as ClaudeCodeSession).subagentCount = subagentCount;
						}
					}
				}

				// Also scan for orphaned subagent directories (sessions archived/compacted with no .jsonl)
				const allDirs = files.filter((f) => !f.endsWith(".jsonl") && !f.endsWith("index.json") && !f.endsWith(".json"));
				for (const dirName of allDirs) {
					if (sessionIdsWithJsonl.has(dirName)) continue; // already processed above
					await scanSubagentDir(projectDir, dirName, cwd ?? "", cwd, sessions, readSessionPreview);
				}
			} catch {}
		}

		sessions.sort((a, b) => b.updatedAt - a.updatedAt);

		// Compute diff stats in parallel for all sessions (cached by mtime)
		await Promise.all(
			sessions.map(async (session) => {
				const fp = session._filePath;
				if (!fp) return;
				const summary = await computeCCSessionStats(fp, session.id);
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

export async function getSession(sessionId: string, cwd?: string): Promise<ClaudeCodeSession | null> {
	const filePath = await findSessionFile(sessionId, cwd);
	if (!filePath) return null;

	const fileStat = await stat(filePath).catch(() => null);
	const preview = await readSessionPreview(filePath);
	const sessionCwd = preview.cwd ?? cwd ?? "";

	const summary = await computeCCSessionStats(filePath, sessionId);
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
): Promise<import("../handlers/session-stats").ModifiedFileEntry[]> {
	const filePath = await findSessionFile(sessionId, cwd);
	if (!filePath) return [];
	const { getCCModifiedFiles } = await import("./claude-code/cc-session-stats");
	return getCCModifiedFiles(filePath);
}

export async function getSessionMessages(
	sessionId: string,
	cwd?: string,
	limit?: number,
): Promise<ClaudeCodeTranscriptMessage[]> {
	const filePath = await findSessionFile(sessionId, cwd);
	if (!filePath) return [];

	try {
		const text = await Bun.file(filePath).text();
		const lines = text.split("\n").filter(Boolean);

		const messages: ClaudeCodeTranscriptMessage[] = [];
		const toolIndexById = new Map<string, { messageIndex: number; toolIndex: number }>();

		for (const line of lines) {
			const parsed = safeParseJsonLine(line) as ClaudeTranscriptLine | null;
			if (!parsed) continue;

			// Skip non-message records (snapshots, etc.)
			if (parsed.type !== "user" && parsed.type !== "assistant") continue;
			if (parsed.isMeta === true) continue;
			if (!parsed.message) continue;

			const role = parsed.message.role;
			const createdAt = isoToMs(parsed.timestamp);
			const id = parsed.uuid || `${parsed.type}-${createdAt}`;

			// User: plain prompt text
			if (role === "user") {
				const maybeText = extractFirstTextContent(parsed.message.content);
				if (maybeText) {
					if (isLikelyCommandEcho(maybeText)) continue;
					messages.push({
						id,
						role: "user",
						createdAt,
						text: maybeText,
					});
					continue;
				}

				// User: tool results (tool_result blocks) - attach to matching tool call.
				const content = parsed.message.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (!block || typeof block !== "object") continue;
						const trBlock = block as TranscriptContentBlock;
						if (trBlock.type !== "tool_result") continue;
						const toolUseId = trBlock.tool_use_id;
						if (!toolUseId) continue;

						const toolOutput = toolResultToText(trBlock.content);
						const toolUseResult = parsed.toolUseResult;

						const idx = toolIndexById.get(toolUseId);
						if (!idx) continue;
						const msg = messages[idx.messageIndex];
						if (!msg) continue;
						const tool = msg.toolCalls?.[idx.toolIndex];
						if (!tool) continue;

						const nextToolCalls = [...(msg.toolCalls ?? [])];
						const nextTool = {
							...tool,
							status: "completed" as const,
							output: toolOutput || tool.output,
							metadata: {
								...(tool.metadata ?? {}),
								...(toolUseResult ? { toolUseResult } : {}),
							},
						};
						nextToolCalls[idx.toolIndex] = nextTool;

						let nextDiffs = msg.diffs ?? [];
						const diff = toolUseResultToDiff(toolUseResult);
						if (diff) {
							nextDiffs = [
								...nextDiffs,
								{
									file: diff.file,
									before: diff.before,
									after: diff.after,
									diff: diff.diff,
									additions: diff.additions,
									deletions: diff.deletions,
									partId: toolUseId,
								},
							];
						}

						messages[idx.messageIndex] = {
							...msg,
							text: msg.text ?? "",

							toolCalls: nextToolCalls,
							diffs: nextDiffs,
						};
					}
				}

				continue;
			}

			// Assistant: content blocks (thinking/text/tool_use)
			if (role === "assistant") {
				const content = parsed.message.content;
				const toolCalls: Array<{
					toolUseId: string;
					tool: string;
					input?: any;
					status: "running" | "completed" | "failed";
					output?: string;
					metadata?: Record<string, unknown>;
				}> = [];

				let thinking = "";
				let textOut = "";

				if (Array.isArray(content)) {
					for (const block of content) {
						if (!block || typeof block !== "object") continue;
						const b = block as TranscriptContentBlock;
						if (b.type === "thinking" && typeof b.thinking === "string") {
							thinking += b.thinking;
						}
						if (b.type === "text" && typeof b.text === "string") {
							textOut += b.text;
						}
						if (b.type === "tool_use") {
							const toolUseId = b.id;
							const tool = b.name;
							const input = b.input;
							if (toolUseId && tool) {
								toolCalls.push({
									toolUseId,
									tool,
									input,
									status: "running",
								});
							}
						}
					}
				} else if (typeof content === "string") {
					textOut = content;
				}

				const msgIndex = messages.length;
				const builtToolCalls = toolCalls.length > 0 ? toolCalls : undefined;
				messages.push({
					id,
					role: "assistant",
					createdAt,
					text: textOut,
					...(thinking.trim().length > 0 ? { thinking } : {}),
					...(builtToolCalls ? { toolCalls: builtToolCalls } : {}),
					diffs: [],
				});

				if (builtToolCalls) {
					for (let i = 0; i < builtToolCalls.length; i++) {
						const tc = builtToolCalls[i];
						if (tc) toolIndexById.set(tc.toolUseId, { messageIndex: msgIndex, toolIndex: i });
					}
				}
			}
		}

		const filtered = messages.filter((m) => m.role !== "system");
		if (limit && limit > 0 && filtered.length > limit) {
			return filtered.slice(filtered.length - limit);
		}
		return filtered;
	} catch {
		return [];
	}
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

export async function listSkills(cwd?: string): Promise<ClaudeCodeSkill[]> {
	const skills: ClaudeCodeSkill[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "skills"));
	}

	searchDirs.push(join(homedir(), ".claude", "skills"));

	for (const dir of searchDirs) {
		const source = classifySource(dir, "skills");
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				const skillPath = join(dir, entry.name, "SKILL.md");
				try {
					const content = await readFile(skillPath, "utf-8");
					const skill = parseSkillFile(entry.name, content);
					if (skill) {
						skills.push({ ...skill, source, path: skillPath });
					}
				} catch {
					skills.push({
						name: entry.name,
						autoInvoke: false,
						source,
						path: skillPath,
					});
				}
			}
		} catch {}
	}

	// Also include skills exposed by enabled plugins.
	try {
		const pluginsModule = await import("../plugins");
		const plugins = await pluginsModule.discoverPlugins(cwd);
		for (const plugin of plugins) {
			if (plugin.status !== "enabled") continue;
			const pluginSkills = Array.isArray(plugin.skills) ? plugin.skills : [];
			if (pluginSkills.length === 0) continue;

			for (const name of pluginSkills) {
				// Prefer explicit .claude/skills definitions if present.
				if (skills.some((s) => s.name === name)) continue;

				const skillPath = join(plugin.path, "skills", name, "SKILL.md");
				try {
					const content = await readFile(skillPath, "utf-8");
					const skill = parseSkillFile(name, content);
					skills.push({ ...skill, source: "plugin", path: skillPath });
				} catch {
					skills.push({ name, autoInvoke: false, source: "plugin", path: skillPath });
				}
			}
		}
	} catch {
		// ignore (plugins optional)
	}

	return skills;
}

function parseSkillFile(name: string, content: string): ClaudeCodeSkill {
	let description: string | undefined;
	let autoInvoke = false;
	const tags: string[] = [];

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";

		const descMatch = frontmatter.match(/description:\s*(.+)/);
		if (descMatch) description = descMatch[1]?.trim();

		const autoMatch = frontmatter.match(/auto-invoke:\s*(true|false)/);
		if (autoMatch) autoInvoke = autoMatch[1] === "true";

		const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]+)\]/);
		if (tagsMatch) {
			tags.push(...(tagsMatch[1] ?? "").split(",").map((t) => t.trim().replace(/['"]/g, "")));
		}
	}

	let agent: string | undefined;
	let context: "fork" | undefined;

	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";
		const agentMatch = frontmatter.match(/agent:\s*(.+)/);
		if (agentMatch) agent = agentMatch[1]?.trim();

		const contextMatch = frontmatter.match(/context:\s*(.+)/);
		if (contextMatch && contextMatch[1]?.trim() === "fork") context = "fork";
	}

	return { name, description, autoInvoke, tags: tags.length > 0 ? tags : undefined, agent, context };
}

export async function listHooks(cwd?: string): Promise<ClaudeCodeHook[]> {
	const hooks: ClaudeCodeHook[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "hooks"));
		searchDirs.push(join(cwd, "hooks"));
	}

	searchDirs.push(join(homedir(), ".claude", "hooks"));

	const parseHooksJson = (hooksJsonPath: string, source: "project" | "user" | "plugin", content: string) => {
		const parsed = JSON.parse(content) as { hooks?: Record<string, any[]>; description?: string };
		if (!parsed.hooks) return;
		let idx = 0;
		for (const [event, matchers] of Object.entries(parsed.hooks)) {
			if (!Array.isArray(matchers)) continue;
			for (const entry of matchers) {
				const matcherValue =
					typeof entry?.matcher === "string"
						? entry.matcher
						: typeof entry?.matcher?.matcher === "string"
							? entry.matcher.matcher
							: undefined;
				const enabled = typeof entry?.enabled === "boolean" ? entry.enabled : true;
				const hooksArr = Array.isArray(entry?.hooks) ? entry.hooks : undefined;
				const description = typeof entry?.description === "string" ? entry.description : undefined;
				hooks.push({
					id: `${source}:${hooksJsonPath}:${event}:${idx++}`,
					event: event as ClaudeCodeHookEvent,
					matcher: matcherValue,
					enabled,
					description,
					hooks: hooksArr,
					source,
					path: hooksJsonPath,
				});
			}
		}
	};

	for (const dir of searchDirs) {
		const source = classifySource(dir, "hooks");
		try {
			const hooksJsonPath = join(dir, "hooks.json");
			const content = await readFile(hooksJsonPath, "utf-8");
			parseHooksJson(hooksJsonPath, source, content);
		} catch {}
	}

	// Also read hooks from settings.json files.
	// Claude Code CLI stores hooks in settings.json under the "hooks" key (the
	// standard approach).  The standalone hooks.json file is an alternative that
	// some projects and plugins use.  We read both so the Broski UI surfaces
	// hooks regardless of which convention the project follows.
	const settingsFiles: Array<{ path: string; source: "project" | "user" }> = [];
	if (cwd) {
		settingsFiles.push({ path: join(cwd, ".claude", "settings.json"), source: "project" });
	}
	settingsFiles.push({ path: join(homedir(), ".claude", "settings.json"), source: "user" });

	for (const { path: settingsPath, source } of settingsFiles) {
		try {
			const raw = await readFile(settingsPath, "utf-8");
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			if (parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)) {
				// Wrap in the same shape as hooks.json so parseHooksJson can handle it.
				parseHooksJson(settingsPath, source, JSON.stringify({ hooks: parsed.hooks }));
			}
		} catch {
			// settings.json missing or unreadable — fine.
		}
	}

	// Also include hooks exposed by enabled plugins.
	try {
		const pluginsModule = await import("../plugins");
		const plugins = await pluginsModule.discoverPlugins(cwd);
		for (const plugin of plugins) {
			if (plugin.status !== "enabled") continue;
			const hooksJsonPath = join(plugin.path, "hooks", "hooks.json");
			try {
				const content = await readFile(hooksJsonPath, "utf-8");
				parseHooksJson(hooksJsonPath, "plugin", content);
			} catch {
				// ignore missing hooks
			}
		}
	} catch {
		// ignore (plugins optional)
	}

	return hooks;
}

async function scanCommandsRecursive(
	baseDir: string,
	currentDir: string,
	source: "project" | "user",
	out: ClaudeCodeCommand[],
): Promise<void> {
	try {
		const entries = await readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;

			const fullPath = join(currentDir, entry.name);

			if (entry.isDirectory()) {
				await scanCommandsRecursive(baseDir, fullPath, source, out);
				continue;
			}

			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

			const rel = relative(baseDir, fullPath);
			const withoutExt = rel.replace(/\.md$/, "");
			const name = withoutExt.replace(/[\\/]/g, ":");

			try {
				const content = await readFile(fullPath, "utf-8");
				const cmd = parseCommandFile(name, content);
				out.push({ ...cmd, source, path: fullPath });
			} catch {
				out.push({ name, source, path: fullPath });
			}
		}
	} catch {
		// ignore (dir doesn't exist)
	}
}

export async function listCommands(cwd?: string): Promise<ClaudeCodeCommand[]> {
	const commands: ClaudeCodeCommand[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "commands"));
	}

	searchDirs.push(join(homedir(), ".claude", "commands"));

	for (const dir of searchDirs) {
		const source = classifySource(dir, "commands");
		await scanCommandsRecursive(dir, dir, source, commands);
	}

	// Also include commands exposed by enabled plugins (so "/" autocomplete finds them).
	try {
		const pluginsModule = await import("../plugins");
		const plugins = await pluginsModule.discoverPlugins(cwd);
		for (const plugin of plugins) {
			if (plugin.status !== "enabled") continue;
			const pluginCommands = Array.isArray(plugin.commands) ? plugin.commands : [];
			if (pluginCommands.length === 0) continue;

			for (const name of pluginCommands) {
				// Prefer explicit .claude/commands definitions if present.
				if (commands.some((c) => c.name === name)) continue;

				const filePath = join(plugin.path, "commands", `${name}.md`);
				try {
					const content = await readFile(filePath, "utf-8");
					commands.push({ ...parseCommandFile(name, content), source: "plugin", path: filePath });
				} catch {
					commands.push({ name, source: "plugin", path: filePath });
				}
			}
		}
	} catch {
		// ignore (plugins optional)
	}

	return commands;
}

function parseCommandFile(name: string, content: string): ClaudeCodeCommand {
	let description: string | undefined;
	let agent: string | undefined;
	let model: string | undefined;
	let subtask = false;

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";

		const descMatch = frontmatter.match(/description:\s*(.+)/);
		if (descMatch) description = descMatch[1]?.trim();

		const agentMatch = frontmatter.match(/agent:\s*(.+)/);
		if (agentMatch) agent = agentMatch[1]?.trim();

		const modelMatch = frontmatter.match(/model:\s*(.+)/);
		if (modelMatch) model = modelMatch[1]?.trim();

		const subtaskMatch = frontmatter.match(/subtask:\s*(true|false)/);
		if (subtaskMatch) subtask = subtaskMatch[1] === "true";
	}

	return { name, description, agent, model, subtask };
}

// ── Filesystem-based Agent Discovery ─────────────────────────────────
// Scans .claude/agents/ directories (project + user) for .md agent files.
// Each .md file defines a subagent that Claude Code auto-loads at session startup.
// See: https://code.claude.com/docs/en/sub-agents

import type { ClaudeCodeFilesystemAgent } from "../types";

function parseAgentFile(name: string, content: string): Omit<ClaudeCodeFilesystemAgent, "source" | "path"> {
	let description: string | undefined;
	let tools: string[] | undefined;
	let model: string | undefined;
	let memory: "user" | "project" | "local" | undefined;
	let background: boolean | undefined;
	let isolation: "worktree" | undefined;

	// Parse YAML frontmatter if present
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";

		const descMatch = frontmatter.match(/description:\s*(.+)/);
		if (descMatch) description = descMatch[1]?.trim();

		const modelMatch = frontmatter.match(/model:\s*(.+)/);
		if (modelMatch) model = modelMatch[1]?.trim();

		const memoryMatch = frontmatter.match(/memory:\s*(.+)/);
		if (memoryMatch) {
			const scope = (memoryMatch[1] ?? "").trim().replace(/['"]/g, "") as "user" | "project" | "local";
			if (scope === "user" || scope === "project" || scope === "local") {
				memory = scope;
			}
		}

		const backgroundMatch = frontmatter.match(/background:\s*(true|false)/);
		if (backgroundMatch) {
			background = backgroundMatch[1] === "true";
		}

		const isolationMatch = frontmatter.match(/isolation:\s*(.+)/);
		if (isolationMatch) {
			const iso = (isolationMatch[1] ?? "").trim().replace(/['"]/g, "");
			if (iso === "worktree") {
				isolation = "worktree";
			}
		}

		// Tools can be comma-separated or YAML array
		const toolsMatch = frontmatter.match(/tools:\s*\[([^\]]*)\]/);
		if (toolsMatch) {
			tools = (toolsMatch[1] ?? "")
				.split(",")
				.map((t) => t.trim().replace(/["']/g, ""))
				.filter(Boolean);
		} else {
			// Check for YAML list format
			const toolsListMatch = frontmatter.match(/tools:\s*\n((?:\s+-\s+.+\n?)+)/);
			if (toolsListMatch) {
				tools = (toolsListMatch[1] ?? "")
					.split("\n")
					.map((line) => line.replace(/^\s*-\s*/, "").trim())
					.filter(Boolean);
			}
		}
	}

	// If no frontmatter description, use first non-empty line after frontmatter
	if (!description) {
		const bodyStart = frontmatterMatch ? content.indexOf("---", 4) + 3 : 0;
		const body = content.slice(bodyStart).trim();
		const firstLine = body.split("\n").find((l) => l.trim() && !l.startsWith("#"));
		if (firstLine) description = firstLine.trim().slice(0, 200);
	}

	// The full content (minus frontmatter) is the agent's prompt/instructions
	const promptStart = frontmatterMatch ? content.indexOf("---", 4) + 3 : 0;
	const prompt = content.slice(promptStart).trim();

	return {
		name,
		description,
		prompt: prompt || undefined,
		tools,
		model,
		memory,
		...(typeof background === "boolean" ? { background } : {}),
		...(isolation ? { isolation } : {}),
	};
}

export async function listAgents(cwd?: string): Promise<ClaudeCodeFilesystemAgent[]> {
	const agents: ClaudeCodeFilesystemAgent[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "agents"));
	}

	searchDirs.push(join(homedir(), ".claude", "agents"));

	for (const dir of searchDirs) {
		const source = classifySource(dir, "agents");
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue;
				if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

				const filePath = join(dir, entry.name);
				const name = entry.name.replace(/\.md$/, "");

				// Skip if we already have an agent with this name (project takes precedence)
				if (agents.some((a) => a.name === name)) continue;

				try {
					const content = await readFile(filePath, "utf-8");
					const parsed = parseAgentFile(name, content);
					agents.push({ ...parsed, source, path: filePath });
				} catch {
					agents.push({ name, source, path: filePath });
				}
			}
		} catch {}
	}

	return agents;
}

// ---------------------------------------------------------------------------
// Memory: read from ~/.claude/memory/ (user), .claude/memory/ (project),
// and ~/.claude/memory-local/ (local).
// The SDK writes memories as individual .md files in these directories.
// ---------------------------------------------------------------------------

import type { ClaudeCodeMemoryEntry } from "../types";

function classifyMemorySource(filename: string, content: string): ClaudeCodeMemoryEntry["source"] {
	const filenameLower = filename.toLowerCase();
	if (
		filenameLower.includes("auto-memory") ||
		filenameLower.includes("automemory") ||
		filenameLower.startsWith("auto-") ||
		filenameLower.includes(".auto.")
	) {
		return "auto";
	}

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = (frontmatterMatch[1] ?? "").toLowerCase();
		const normalized = frontmatter.replace(/\s+/g, " ");
		if (/(^|\s)(source|memory_source|origin|type):\s*['"]?auto['"]?(\s|$)/.test(normalized)) {
			return "auto";
		}
		if (/(^|\s)(source|memory_source|origin|type):\s*['"]?manual['"]?(\s|$)/.test(normalized)) {
			return "manual";
		}
	}

	const contentLower = content.toLowerCase();
	if (contentLower.includes("auto-memory") || contentLower.includes("generated automatically")) {
		return "auto";
	}

	return "unknown";
}

async function readMemoryDir(dir: string, scope: "user" | "project" | "local"): Promise<ClaudeCodeMemoryEntry[]> {
	const entries: ClaudeCodeMemoryEntry[] = [];
	try {
		const files = await readdir(dir, { withFileTypes: true });
		for (const file of files) {
			if (!file.isFile()) continue;
			if (file.name.startsWith(".")) continue;
			const filePath = join(dir, file.name);
			try {
				const content = await readFile(filePath, "utf-8");
				// Try to extract date from filename (e.g. "2025-02-07T12-00-00.md")
				const dateMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})/);
				entries.push({
					scope,
					filename: file.name,
					content: content.trim(),
					createdAt: dateMatch ? dateMatch[1] : undefined,
					path: filePath,
					source: classifyMemorySource(file.name, content),
				});
			} catch {
				// Skip unreadable files
			}
		}
	} catch {
		// Directory doesn't exist — that's fine
	}
	return entries;
}

export async function listMemories(
	scope?: "user" | "project" | "local",
	cwd?: string,
): Promise<ClaudeCodeMemoryEntry[]> {
	const results: ClaudeCodeMemoryEntry[] = [];
	const home = homedir();

	const dirs: Array<{ path: string; scope: "user" | "project" | "local" }> = [];
	if (!scope || scope === "user") {
		dirs.push({ path: join(home, ".claude", "memory"), scope: "user" });
	}
	if (!scope || scope === "project") {
		if (cwd) {
			dirs.push({ path: join(cwd, ".claude", "memory"), scope: "project" });
		}
	}
	if (!scope || scope === "local") {
		dirs.push({ path: join(home, ".claude", "memory-local"), scope: "local" });
	}

	for (const { path, scope: s } of dirs) {
		const memories = await readMemoryDir(path, s);
		results.push(...memories);
	}

	// Sort newest first
	results.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
	return results;
}

export async function deleteMemory(
	scope: "user" | "project" | "local",
	filename: string,
	cwd?: string,
): Promise<boolean> {
	const home = homedir();
	let dir: string;
	switch (scope) {
		case "user":
			dir = join(home, ".claude", "memory");
			break;
		case "project":
			if (!cwd) return false;
			dir = join(cwd, ".claude", "memory");
			break;
		case "local":
			dir = join(home, ".claude", "memory-local");
			break;
	}

	const filePath = join(dir, filename);
	// Security: ensure the resolved path is inside the expected directory
	const { realpath } = await import("fs/promises");
	try {
		const resolvedDir = await realpath(dir);
		const resolvedFile = await realpath(filePath);
		if (!resolvedFile.startsWith(resolvedDir)) return false;
	} catch {
		return false;
	}

	try {
		await (await import("fs/promises")).unlink(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function getConfig(cwd?: string): Promise<ClaudeCodeConfig> {
	const cfg: ClaudeCodeConfig = { ...currentConfig };

	if (cwd) {
		const settings = await readProjectSettings(cwd);
		if (typeof settings.language === "string" && settings.language.trim().length > 0) {
			cfg.language = settings.language.trim();
		}
		if (
			typeof settings.releaseChannel === "string" &&
			(settings.releaseChannel === "stable" || settings.releaseChannel === "latest")
		) {
			cfg.releaseChannel = settings.releaseChannel;
		}
		if (typeof settings.respectGitignore === "boolean") {
			cfg.respectGitignore = settings.respectGitignore;
		}
	}

	return cfg;
}

export async function setConfig(config: Partial<ClaudeCodeConfig>, cwd?: string): Promise<ClaudeCodeConfig> {
	const normalized: Partial<ClaudeCodeConfig> = {
		...config,
		...(config.betas ? { betas: normalizeBetas(config.betas) } : {}),
	};

	if ("maxTurns" in normalized && typeof normalized.maxTurns === "number" && normalized.maxTurns <= 0) {
		normalized.maxTurns = undefined;
	}
	if ("maxBudgetUsd" in normalized && typeof normalized.maxBudgetUsd === "number" && normalized.maxBudgetUsd <= 0) {
		normalized.maxBudgetUsd = undefined;
	}

	currentConfig = { ...currentConfig, ...normalized };

	// Persist our app-level defaults (allowedTools, systemPrompt, etc).
	// Fire-and-forget so the caller isn't blocked on IO.
	queueMicrotask(() => {
		persistConfig().catch(() => {});
	});

	// Also apply project-scoped settings when a cwd is provided.
	if (cwd) {
		const touchesProjectSettings = "language" in config || "releaseChannel" in config || "respectGitignore" in config;

		if (touchesProjectSettings) {
			const settings = await readProjectSettings(cwd);
			const nextSettings = applyProjectSettingsPatch(settings, {
				language: config.language,
				releaseChannel: config.releaseChannel,
				respectGitignore: config.respectGitignore,
			});
			await writeProjectSettings(cwd, nextSettings);
		}
	}

	return await getConfig(cwd);
}

/**
 * Convert an array of ClaudeCodeSubagent to SDK's agents Record format.
 * The SDK expects agents as Record<name, { description, prompt, tools?, model? }>
 */
function convertSubagentsToRecord(subagents: ClaudeCodeSubagent[]): Record<
	string,
	{
		description: string;
		prompt: string;
		tools?: string[];
		model?: string;
		permissionMode?: string;
		disallowedTools?: string[];
		skills?: string[];
		maxTurns?: number;
		mcpServers?: Array<string | Record<string, unknown>>;
		background?: boolean;
		isolation?: "worktree";
	}
> {
	const record: Record<
		string,
		{
			description: string;
			prompt: string;
			tools?: string[];
			model?: string;
			permissionMode?: string;
			disallowedTools?: string[];
			skills?: string[];
			maxTurns?: number;
			mcpServers?: Array<string | Record<string, unknown>>;
			background?: boolean;
			isolation?: "worktree";
		}
	> = {};
	for (const agent of subagents) {
		record[agent.name] = {
			description: agent.description,
			prompt: agent.prompt,
			...(agent.tools?.length && { tools: agent.tools }),
			...(agent.model && agent.model !== "inherit" && { model: agent.model }),
			...(agent.permissionMode && { permissionMode: agent.permissionMode }),
			...(agent.disallowedTools?.length && { disallowedTools: agent.disallowedTools }),
			...(agent.skills?.length && { skills: agent.skills }),
			...(typeof agent.maxTurns === "number" && agent.maxTurns > 0 && { maxTurns: agent.maxTurns }),
			...(agent.mcpServers?.length && { mcpServers: agent.mcpServers }),
			...(agent.background === true ? { background: true } : {}),
			...(agent.isolation === "worktree" ? { isolation: "worktree" as const } : {}),
		};
	}
	return record;
}

function normalizeAccountInfo(data: unknown): ClaudeCodeAccountInfo {
	if (!data || typeof data !== "object") return {};
	const raw = data as Record<string, unknown>;
	return {
		...(typeof raw.email === "string" ? { email: raw.email } : {}),
		...(typeof raw.organization === "string" ? { organization: raw.organization } : {}),
		...(typeof raw.subscriptionType === "string" ? { subscriptionType: raw.subscriptionType } : {}),
		...(typeof raw.tokenSource === "string" ? { tokenSource: raw.tokenSource } : {}),
		...(typeof raw.apiKeySource === "string" ? { apiKeySource: raw.apiKeySource } : {}),
		...(typeof raw.accountUuid === "string" ? { accountUuid: raw.accountUuid } : {}),
		...(typeof raw.organizationUuid === "string" ? { organizationUuid: raw.organizationUuid } : {}),
		apiProvider: typeof raw.apiProvider === "string" ? raw.apiProvider : null,
	};
}

function normalizeMcpServerStatuses(statuses: unknown): ClaudeCodeMcpServerStatus[] {
	if (!Array.isArray(statuses)) return [];
	return statuses
		.map((item) => {
			if (!item || typeof item !== "object") return null;
			const raw = item as Partial<SDKMcpServerStatus>;
			const name = String(raw.name ?? "").trim();
			const status = String(raw.status ?? "").trim();
			if (!name) return null;
			if (
				status !== "connected" &&
				status !== "failed" &&
				status !== "needs-auth" &&
				status !== "pending" &&
				status !== "disabled"
			) {
				return null;
			}
			const info = raw.serverInfo;
			const serverInfo =
				info && typeof info === "object"
					? {
							name: String(info.name ?? "").trim(),
							version: String(info.version ?? "").trim(),
						}
					: undefined;
			const errorMsg = typeof raw.error === "string" ? raw.error : undefined;
			const scope = typeof raw.scope === "string" ? raw.scope : undefined;
			const rawTools = raw.tools;
			const tools =
				rawTools
					?.map((t) => {
						const entry: {
							name: string;
							description?: string;
							annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean };
						} = {
							name: String(t?.name ?? ""),
						};
						if (typeof t?.description === "string") entry.description = t.description;
						if (t?.annotations && typeof t.annotations === "object") {
							const ann: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } = {};
							if (typeof t.annotations.readOnly === "boolean") ann.readOnly = t.annotations.readOnly;
							if (typeof t.annotations.destructive === "boolean") ann.destructive = t.annotations.destructive;
							if (typeof t.annotations.openWorld === "boolean") ann.openWorld = t.annotations.openWorld;
							if (Object.keys(ann).length > 0) entry.annotations = ann;
						}
						return entry;
					})
					.filter((t) => t.name) ?? undefined;
			// Forward server config (B12: URLs, transport type)
			const rawConfig = raw.config;
			const config = rawConfig && typeof rawConfig === "object" ? rawConfig : undefined;
			return {
				name,
				status,
				...(serverInfo?.name && serverInfo.version ? { serverInfo } : {}),
				...(errorMsg ? { error: errorMsg } : {}),
				...(config ? { config } : {}),
				...(scope ? { scope } : {}),
				...(tools && tools.length > 0 ? { tools } : {}),
			} as ClaudeCodeMcpServerStatus;
		})
		.filter((item): item is ClaudeCodeMcpServerStatus => item != null);
}

function normalizeModelUsage(modelUsage: unknown):
	| Record<
			string,
			{
				inputTokens: number;
				outputTokens: number;
				cacheReadInputTokens: number;
				cacheCreationInputTokens: number;
				webSearchRequests: number;
				costUSD: number;
				contextWindow: number;
				maxOutputTokens: number;
			}
	  >
	| undefined {
	if (!modelUsage || typeof modelUsage !== "object") return undefined;
	const entries = Object.entries(modelUsage as Record<string, unknown>);
	if (entries.length === 0) return undefined;

	const normalizedEntries = entries
		.map(([modelName, usage]) => {
			if (!usage || typeof usage !== "object") return null;
			const raw = usage as Record<string, unknown>;
			const normalized = {
				inputTokens: Number(raw.inputTokens ?? 0) || 0,
				outputTokens: Number(raw.outputTokens ?? 0) || 0,
				cacheReadInputTokens: Number(raw.cacheReadInputTokens ?? 0) || 0,
				cacheCreationInputTokens: Number(raw.cacheCreationInputTokens ?? 0) || 0,
				webSearchRequests: Number(raw.webSearchRequests ?? 0) || 0,
				costUSD: Number(raw.costUSD ?? 0) || 0,
				contextWindow: Number(raw.contextWindow ?? 0) || 0,
				maxOutputTokens: Number(raw.maxOutputTokens ?? 0) || 0,
			};
			return [modelName, normalized] as const;
		})
		.filter(
			(
				item,
			): item is readonly [
				string,
				{
					inputTokens: number;
					outputTokens: number;
					cacheReadInputTokens: number;
					cacheCreationInputTokens: number;
					webSearchRequests: number;
					costUSD: number;
					contextWindow: number;
					maxOutputTokens: number;
				},
			] => item != null,
		);

	if (normalizedEntries.length === 0) return undefined;
	return Object.fromEntries(normalizedEntries);
}

function normalizePermissionDenials(
	permissionDenials: unknown,
): Array<{ toolName: string; toolUseId: string; toolInput?: Record<string, unknown> }> | undefined {
	if (!Array.isArray(permissionDenials) || permissionDenials.length === 0) return undefined;

	const normalized = permissionDenials
		.map((entry) => {
			if (!entry || typeof entry !== "object") return null;
			const raw = entry as Record<string, unknown>;
			const toolName = typeof raw.tool_name === "string" ? raw.tool_name : "";
			const toolUseId = typeof raw.tool_use_id === "string" ? raw.tool_use_id : "";
			if (!toolName || !toolUseId) return null;

			const toolInput =
				raw.tool_input && typeof raw.tool_input === "object" && !Array.isArray(raw.tool_input)
					? (raw.tool_input as Record<string, unknown>)
					: undefined;

			return {
				toolName,
				toolUseId,
				...(toolInput ? { toolInput } : {}),
			};
		})
		.filter(
			(entry): entry is { toolName: string; toolUseId: string; toolInput?: Record<string, unknown> } => entry != null,
		);

	return normalized.length > 0 ? normalized : undefined;
}

function pickContextWindow(
	modelUsage: Record<string, { contextWindow: number }> | undefined,
	preferredModel?: string,
): number | undefined {
	if (!modelUsage || Object.keys(modelUsage).length === 0) return undefined;
	if (preferredModel && modelUsage[preferredModel]?.contextWindow) {
		return modelUsage[preferredModel].contextWindow;
	}
	const first = Object.values(modelUsage).find((entry) => entry.contextWindow > 0);
	return first?.contextWindow;
}

function cacheCapabilities(
	cwd: string | undefined,
	capabilities: {
		supportedModels?: ClaudeCodeSupportedModel[];
		accountInfo?: ClaudeCodeAccountInfo;
		mcpStatuses?: ClaudeCodeMcpServerStatus[];
	},
): void {
	const key = cwdCacheKey(cwd);
	if (capabilities.supportedModels && capabilities.supportedModels.length > 0) {
		ccSupportedModelsByCwd.set(key, capabilities.supportedModels);
	}
	if (capabilities.accountInfo && Object.keys(capabilities.accountInfo).length > 0) {
		ccAccountInfoByCwd.set(key, capabilities.accountInfo);
	}
	if (capabilities.mcpStatuses && capabilities.mcpStatuses.length > 0) {
		ccMcpStatusByCwd.set(key, capabilities.mcpStatuses);
	}
}

async function collectCapabilitiesFromQuery(
	q: any,
	cwd?: string,
): Promise<{
	supportedModels?: ClaudeCodeSupportedModel[];
	accountInfo?: ClaudeCodeAccountInfo;
	mcpStatuses?: ClaudeCodeMcpServerStatus[];
}> {
	const [modelsResult, accountResult, mcpResult] = await Promise.allSettled([
		typeof q?.supportedModels === "function" ? q.supportedModels() : Promise.resolve([]),
		typeof q?.accountInfo === "function" ? q.accountInfo() : Promise.resolve({}),
		typeof q?.mcpServerStatus === "function" ? q.mcpServerStatus() : Promise.resolve([]),
	]);

	const supportedModels = modelsResult.status === "fulfilled" ? normalizeSupportedModels(modelsResult.value) : [];
	const accountInfo = accountResult.status === "fulfilled" ? normalizeAccountInfo(accountResult.value) : {};
	const mcpStatuses = mcpResult.status === "fulfilled" ? normalizeMcpServerStatuses(mcpResult.value) : [];

	cacheCapabilities(cwd, { supportedModels, accountInfo, mcpStatuses });

	return {
		...(supportedModels.length > 0 ? { supportedModels } : {}),
		...(Object.keys(accountInfo).length > 0 ? { accountInfo } : {}),
		...(mcpStatuses.length > 0 ? { mcpStatuses } : {}),
	};
}

async function callActiveSessionCapability<T>(
	cwd: string | undefined,
	method: (q: SDKQuery) => Promise<T>,
): Promise<T | undefined> {
	const normalizedCwd = (cwd || "").trim();
	for (const [, session] of activeSessions.entries()) {
		if (normalizedCwd && session.cwd !== normalizedCwd) continue;
		if (!session.query) continue;
		try {
			return await method(session.query);
		} catch {}
	}
	return undefined;
}

export async function getSupportedModels(cwd?: string): Promise<ClaudeCodeSupportedModel[]> {
	const key = cwdCacheKey(cwd);
	const cached = ccSupportedModelsByCwd.get(key);
	if (cached && cached.length > 0) return cached;

	const fromActive = await callActiveSessionCapability(cwd, async (q) => {
		const normalized = normalizeSupportedModels(await q.supportedModels());
		if (normalized.length > 0) {
			ccSupportedModelsByCwd.set(key, normalized);
		}
		return normalized;
	});
	if (Array.isArray(fromActive) && fromActive.length > 0) return fromActive;

	const fallback = fallbackSupportedModels();
	ccSupportedModelsByCwd.set(key, fallback);
	return fallback;
}

export async function getAccountInfo(cwd?: string): Promise<ClaudeCodeAccountInfo> {
	const key = cwdCacheKey(cwd);
	const cached = ccAccountInfoByCwd.get(key);
	if (cached) return cached;

	const fromActive = await callActiveSessionCapability(cwd, async (q) => {
		const normalized = normalizeAccountInfo(await q.accountInfo());
		if (Object.keys(normalized).length > 0) {
			ccAccountInfoByCwd.set(key, normalized);
		}
		return normalized;
	});
	if (fromActive && Object.keys(fromActive).length > 0) return fromActive;

	return {};
}

export async function getMcpServerStatus(cwd?: string): Promise<ClaudeCodeMcpServerStatus[]> {
	const key = cwdCacheKey(cwd);
	const cached = ccMcpStatusByCwd.get(key);
	if (cached && cached.length > 0) return cached;

	const fromActive = await callActiveSessionCapability(cwd, async (q) => {
		const normalized = normalizeMcpServerStatuses(await q.mcpServerStatus());
		if (normalized.length > 0) {
			ccMcpStatusByCwd.set(key, normalized);
		}
		return normalized;
	});
	if (Array.isArray(fromActive) && fromActive.length > 0) return fromActive;

	return [];
}

export async function queryClaudeCode(
	prompt: string,
	options: ClaudeCodeQueryOptions,
	onMessage: (message: ClaudeCodeStreamMessage) => void,
	onComplete: (sessionId: string) => void,
	onError: (error: Error) => void,
	onPermissionRequest?: (request: {
		sessionId: string;
		toolUseId: string;
		tool: string;
		input: Record<string, unknown>;
		decisionReason?: string;
		blockedPath?: string;
		hasSuggestions?: boolean;
		suggestions?: unknown[]; // SDK 0.2.87: PermissionUpdate[] for "Always Allow" persistence
		title?: string; // SDK 0.2.87: Full permission prompt sentence
		displayName?: string; // SDK 0.2.87: Short noun phrase (e.g. "Read file")
		description?: string;
		agentId?: string;
	}) => Promise<
		| PermissionResponse
		| {
				response: PermissionResponse;
				updatedInput?: Record<string, unknown>;
				updatedPermissions?: unknown[]; // SDK 0.2.87: PermissionUpdate[] from Flutter
				decisionClassification?: string; // SDK 0.2.87
		  }
	>,
	onElicitationRequest?: (request: {
		sessionId: string;
		requestId: string;
		mcpServerName: string;
		message: string;
		mode?: "form" | "url";
		url?: string;
		elicitationId?: string;
		requestedSchema?: Record<string, unknown>;
	}) => Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }>,
): Promise<void> {
	let sessionId: string | null = options.sessionId || null;
	const controller = new AbortController();
	let sawStreamEvents = false;
	// Track stream_event tool_use blocks so input_json_delta can update live tool inputs.
	const toolUseIdByStreamIndex = new Map<number, string>();
	const toolNameByToolUseId = new Map<string, string>();
	const toolInputJsonBufferByToolUseId = new Map<string, string>();

	try {
		const systemPrompt = options.systemPrompt ?? currentConfig.systemPrompt;
		const enableCheckpointing = options.enableFileCheckpointing ?? true; // Default to true for undo support
		const betas = normalizeBetas(options.betas ?? currentConfig.betas);
		const maxTurns = typeof options.maxTurns === "number" ? options.maxTurns : currentConfig.maxTurns;
		const maxBudgetUsd = typeof options.maxBudgetUsd === "number" ? options.maxBudgetUsd : currentConfig.maxBudgetUsd;
		const sandbox = options.sandbox ?? currentConfig.sandbox;
		const outputFormat = options.outputFormat ?? currentConfig.outputFormat;
		const enableAgentTeams = options.enableAgentTeams ?? currentConfig.enableAgentTeams ?? false;

		const thinking = options.thinking ?? currentConfig.thinking;
		const effort = options.effort ?? currentConfig.effort;
		const persistSession = options.persistSession;
		const promptSuggestions = options.promptSuggestions ?? currentConfig.promptSuggestions;
		const enableClaudeAiMcpServers = options.enableClaudeAiMcpServers ?? currentConfig.enableClaudeAiMcpServers;

		const sdkOptions: Partial<Options> & { extraArgs?: Record<string, string | null> } = {
			cwd: options.cwd,
			model: options.model || currentConfig.model || "sonnet",
			allowedTools: options.allowedTools || currentConfig.allowedTools,
			disallowedTools: options.disallowedTools || currentConfig.disallowedTools,
			permissionMode: options.permissionMode || currentConfig.permissionMode,
			// Required for real-time text deltas (SDK docs: default is false).
			includePartialMessages: true,
			abortController: controller,
			settingSources: ["project", "local", "user"],
			// File checkpointing: enable tracking of file changes for undo/rewind support
			...(enableCheckpointing && {
				enableFileCheckpointing: true,
				extraArgs: { "replay-user-messages": null }, // Required to get user message UUIDs
			}),
			// SDK 0.2.42: structured thinking option (replaces maxThinkingTokens)
			...(thinking ? { thinking } : {}),
			// SDK 0.2.42: effort level
			...(effort ? { effort } : {}),
			// SDK 0.2.42: top-level agent selection
			...(options.agent ? { agent: options.agent } : {}),
			// SDK 0.2.42: session persistence control
			...(typeof persistSession === "boolean" ? { persistSession } : {}),
			// SDK 0.2.52: prompt suggestions
			...(typeof promptSuggestions === "boolean" ? { promptSuggestions } : {}),
			// B5: fallback model
			...(options.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
			// B6: additional directories
			...(options.additionalDirectories?.length ? { additionalDirectories: options.additionalDirectories } : {}),
			// SDK 0.2.74: AI-generated progress summaries for subagents
			...(options.agentProgressSummaries !== undefined
				? { agentProgressSummaries: options.agentProgressSummaries }
				: {}),
		};

		if (Array.isArray(betas) && betas.length > 0) {
			sdkOptions.betas = betas;
		}
		if (typeof maxTurns === "number" && maxTurns > 0) {
			sdkOptions.maxTurns = maxTurns;
		}
		if (typeof maxBudgetUsd === "number" && maxBudgetUsd > 0) {
			sdkOptions.maxBudgetUsd = maxBudgetUsd;
		}
		if (sandbox && typeof sandbox === "object") {
			sdkOptions.sandbox = sandbox;
		}
		if (outputFormat && typeof outputFormat === "object") {
			sdkOptions.outputFormat = outputFormat;
		}
		if (sdkOptions.permissionMode === "bypassPermissions") {
			sdkOptions.allowDangerouslySkipPermissions = true;
		}

		// Build env overrides: merge checkpointing + agent teams flags into process.env.
		// SDK docs require CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1 for checkpoint tracking.
		const envOverrides: Record<string, string> = {};
		if (enableCheckpointing) {
			envOverrides.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = "1";
		}
		if (enableAgentTeams) {
			envOverrides.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
		}
		if (enableClaudeAiMcpServers === false) {
			envOverrides.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
		}

		const cachedAccountInfo = ccAccountInfoByCwd.get(cwdCacheKey(options.cwd));
		if (typeof cachedAccountInfo?.email === "string" && cachedAccountInfo.email.length > 0) {
			envOverrides.CLAUDE_CODE_USER_EMAIL = cachedAccountInfo.email;
		}
		if (typeof cachedAccountInfo?.accountUuid === "string" && cachedAccountInfo.accountUuid.length > 0) {
			envOverrides.CLAUDE_CODE_ACCOUNT_UUID = cachedAccountInfo.accountUuid;
		}
		const organizationUuid =
			typeof cachedAccountInfo?.organizationUuid === "string" && cachedAccountInfo.organizationUuid.length > 0
				? cachedAccountInfo.organizationUuid
				: typeof cachedAccountInfo?.organization === "string" && cachedAccountInfo.organization.length > 0
					? cachedAccountInfo.organization
					: undefined;
		if (organizationUuid) {
			envOverrides.CLAUDE_CODE_ORGANIZATION_UUID = organizationUuid;
		}

		if (Object.keys(envOverrides).length > 0) {
			sdkOptions.env = {
				...(process.env as Record<string, string | undefined>),
				...envOverrides,
			};
		}

		if (systemPrompt) {
			// Narrow preset type to match SDK's literal 'claude_code' requirement
			if (typeof systemPrompt === "string") {
				sdkOptions.systemPrompt = systemPrompt;
			} else if (systemPrompt.type === "preset" && systemPrompt.preset === "claude_code") {
				sdkOptions.systemPrompt = { type: "preset", preset: "claude_code" as const, append: systemPrompt.append };
			}
		}

		// Custom subagents: Convert from our format to SDK's AgentDefinition format
		// Note: agents must include the Task tool in allowedTools for subagent invocation to work
		const agents =
			options.agents ||
			(currentConfig.subagents?.length ? convertSubagentsToRecord(currentConfig.subagents) : undefined);
		if (agents && Object.keys(agents).length > 0) {
			// Ensure Task tool stays available when subagents are configured (SDK uses Task for invocation).
			if (Array.isArray(sdkOptions.allowedTools) && !sdkOptions.allowedTools.includes("Task")) {
				sdkOptions.allowedTools = [...sdkOptions.allowedTools, "Task"];
			}
			sdkOptions.agents = agents as Record<string, import("@anthropic-ai/claude-agent-sdk").AgentDefinition>;
		}

		// Custom MCP Tools: Load user-defined custom tools
		try {
			const customToolsModule = await import("../custom-tools");
			const customToolsServer = await customToolsModule.createCustomToolsServer();
			if (customToolsServer) {
				sdkOptions.mcpServers = {
					...sdkOptions.mcpServers,
					"broski-custom-tools": customToolsServer,
				};
			}
		} catch (err) {
			// Custom tools are optional, log but don't fail
			console.warn("[Claude Code] Failed to load custom tools:", err);
		}

		// Load enabled plugins
		try {
			const pluginsModule = await import("../plugins");
			const enabledPlugins = await pluginsModule.getEnabledPluginsForSdk(options.cwd);
			if (enabledPlugins.length > 0) {
				sdkOptions.plugins = enabledPlugins;
			}
		} catch (err) {
			// Plugins are optional, log but don't fail
			console.warn("[Claude Code] Failed to load plugins:", err);
		}

		if (options.sessionId) {
			sdkOptions.resume = options.sessionId;
			if (options.resumeSessionAt) {
				sdkOptions.resumeSessionAt = options.resumeSessionAt;
			}
			// SDK 0.2.87: Fork on resume — create a branch instead of modifying original
			if (options.forkOnResume) {
				sdkOptions.forkSession = true;
			}
		} else if (options.continueSession) {
			// SDK 0.2.87: Continue most recent conversation in cwd (mutually exclusive with resume)
			sdkOptions.continue = true;
		}

		if (onPermissionRequest) {
			sdkOptions.canUseTool = async (toolName, input, ctx) => {
				// Compliance: honour abort signal — if session was aborted while
				// waiting for permission, reject immediately.
				if (ctx.signal?.aborted) {
					return { behavior: "deny", message: "Session aborted", toolUseID: ctx.toolUseID };
				}
				const sid = sessionId ?? options.sessionId ?? "";
				const hasSuggestions = Array.isArray(ctx.suggestions) && ctx.suggestions.length > 0;
				const decision = await onPermissionRequest({
					sessionId: sid,
					toolUseId: ctx.toolUseID,
					tool: toolName,
					input,
					decisionReason: ctx.decisionReason,
					blockedPath: ctx.blockedPath,
					hasSuggestions,
					// SDK 0.2.87: Forward full suggestions array for "Always Allow" rule persistence
					...(hasSuggestions ? { suggestions: ctx.suggestions } : {}),
					// SDK 0.2.87: Human-readable fields from the bridge
					...(typeof ctx.title === "string" ? { title: ctx.title } : {}),
					...(typeof ctx.displayName === "string" ? { displayName: ctx.displayName } : {}),
					// Description: prefer SDK-provided, fall back to tool input
					description:
						typeof ctx.description === "string"
							? ctx.description
							: typeof input?.description === "string"
								? input.description
								: undefined,
					agentId: ctx.agentID,
				});

				const rawResponse = typeof decision === "string" ? decision : decision?.response;
				const response: PermissionResponse =
					rawResponse === "once" || rawResponse === "always" || rawResponse === "reject" ? rawResponse : "reject";
				const updatedInput =
					typeof decision === "object" &&
					decision?.updatedInput &&
					typeof decision.updatedInput === "object" &&
					!Array.isArray(decision.updatedInput)
						? decision.updatedInput
						: input;

				if (response === "reject") {
					return {
						behavior: "deny",
						message: "User denied permission",
						interrupt: true,
						toolUseID: ctx.toolUseID,
						decisionClassification: "user_reject" as const,
					};
				}

				// SDK 0.2.87: Use updatedPermissions from Flutter response if provided,
				// otherwise fall back to SDK suggestions (backward compat)
				const suggestionsFromSdk =
					Array.isArray(ctx.suggestions) && ctx.suggestions.length > 0 ? ctx.suggestions : undefined;
				const permissionsFromDecision =
					typeof decision === "object" && Array.isArray(decision?.updatedPermissions)
						? (decision.updatedPermissions as typeof ctx.suggestions)
						: undefined;
				const updatedPermissions = response === "always" ? (permissionsFromDecision ?? suggestionsFromSdk) : undefined;

				return {
					behavior: "allow" as const,
					updatedInput,
					...(updatedPermissions ? { updatedPermissions } : {}),
					toolUseID: ctx.toolUseID,
					decisionClassification: response === "always" ? ("user_permanent" as const) : ("user_temporary" as const),
				};
			};
		}

		sdkOptions.onElicitation = async (
			request: ElicitationRequest,
			ctx: { signal: AbortSignal },
		): Promise<ElicitationResult> => {
			if (ctx.signal?.aborted) {
				return { action: "cancel" };
			}

			if (!onElicitationRequest) {
				return { action: "decline" };
			}

			const sid = sessionId ?? options.sessionId ?? "";
			const requestId = randomBytes(8).toString("hex");

			const response = await onElicitationRequest({
				sessionId: sid,
				requestId,
				mcpServerName: request.serverName,
				message: request.message,
				mode: request.mode,
				url: request.url,
				elicitationId: request.elicitationId,
				requestedSchema: request.requestedSchema,
			});

			const action =
				response.action === "accept" || response.action === "decline" || response.action === "cancel"
					? response.action
					: "cancel";

			if (action !== "accept") {
				return { action };
			}

			const content =
				response.content && typeof response.content === "object" && !Array.isArray(response.content)
					? (response.content as Record<string, string | number | boolean | string[]>)
					: undefined;

			return {
				action: "accept" as const,
				...(content ? { content } : {}),
			};
		};

		// If activeSubagent is specified and no top-level `agent` was set,
		// use the SDK 0.2.42 `agent` option for proper subagent routing.
		// Falls back to prompt hint for agents not in the `agents` option.
		let finalPrompt = prompt;
		if (options.activeSubagent && !sdkOptions.agent) {
			const agentName = options.activeSubagent;
			const configuredAgents = sdkOptions.agents || {};
			if (configuredAgents[agentName]) {
				// SDK 0.2.42: use proper `agent` option
				sdkOptions.agent = agentName;
			} else {
				// Fallback: prompt hint for filesystem-based agents
				finalPrompt = `Use the ${agentName} agent to handle this request.\n\n${prompt}`;
			}
		}

		// Compliance: if no structured `thinking` was set, convert legacy
		// variant/maxThinkingTokens to the proper `thinking` option on sdkOptions
		// BEFORE creating the query. setMaxThinkingTokens() is deprecated.
		if (!sdkOptions.thinking) {
			let thinkingTokens = options.maxThinkingTokens;
			if (thinkingTokens === undefined && options.variant) {
				thinkingTokens = variantToThinkingTokens(options.variant);
			}
			if (thinkingTokens !== undefined && thinkingTokens !== null) {
				if (thinkingTokens === 0) {
					sdkOptions.thinking = { type: "disabled" };
				} else {
					sdkOptions.thinking = { type: "enabled", budgetTokens: thinkingTokens };
				}
			}
		}

		const q = query({ prompt: finalPrompt, options: sdkOptions });

		for await (const message of q) {
			// Extract parent_tool_use_id from SDK message for subagent context tracking.
			// When non-null, this message originated from inside a subagent's execution.
			const parentToolUseId =
				"parent_tool_use_id" in message ? (message.parent_tool_use_id as string | undefined) : undefined;
			const emit = (msg: Record<string, unknown>) =>
				onMessage((parentToolUseId ? { ...msg, parentToolUseId } : msg) as ClaudeCodeStreamMessage);

			// System init: session created + capabilities snapshot (tools/commands/etc)
			if (message?.type === "system" && message?.subtype === "init") {
				sessionId = message.session_id;
				activeSessions.set(sessionId, {
					controller,
					cwd: options.cwd,
					query: q,
					startedAt: Date.now(),
				});
				emit({
					type: "session-created",
					sessionId,
					agent: "claude-code",
					model: message.model || sdkOptions.model,
				});

				const initMcpServers = Array.isArray(message.mcp_servers) ? message.mcp_servers : [];
				const initMcpStatuses = normalizeMcpServerStatuses(
					initMcpServers.map((server: any) => ({
						name: server?.name,
						status: server?.status,
					})),
				);
				cacheCapabilities(options.cwd, { mcpStatuses: initMcpStatuses });

				let capabilities:
					| {
							supportedModels?: ClaudeCodeSupportedModel[];
							accountInfo?: ClaudeCodeAccountInfo;
							mcpStatuses?: ClaudeCodeMcpServerStatus[];
					  }
					| undefined;
				try {
					capabilities = await collectCapabilitiesFromQuery(q, options.cwd);
				} catch {
					capabilities = undefined;
				}

				emit({
					type: "session-init",
					sessionId,
					model: message.model || sdkOptions.model,
					permissionMode: message.permissionMode || sdkOptions.permissionMode,
					tools: Array.isArray(message.tools) ? message.tools : [],
					slashCommands: Array.isArray(message.slash_commands) ? message.slash_commands : [],
					skills: Array.isArray(message.skills) ? message.skills : [],
					agents: Array.isArray(message.agents) ? message.agents : [],
					mcpServers: capabilities?.mcpStatuses ?? initMcpServers,
					plugins: Array.isArray(message.plugins) ? message.plugins : [],
					apiKeySource: message.apiKeySource,
					claudeCodeVersion: message.claude_code_version,
					// B15: forward active betas and output style
					...(Array.isArray(message.betas) && message.betas.length > 0 ? { betas: message.betas } : {}),
					...(message.output_style ? { outputStyle: message.output_style } : {}),
					...(() => {
						const aos = (message as Record<string, unknown>).available_output_styles;
						return Array.isArray(aos) && aos.length > 0 ? { availableOutputStyles: aos } : {};
					})(),
					...(message.cwd ? { cwd: message.cwd } : {}),
					supportedModels: capabilities?.supportedModels,
					accountInfo: capabilities?.accountInfo,
					...(typeof message.fast_mode_state === "string" ? { fastModeState: message.fast_mode_state } : {}),
				});

				// (Legacy thinking fallback was moved before query() call — see below)
			}

			if (message?.type === "system" && message?.subtype === "compact_boundary") {
				const trigger = message?.compact_metadata?.trigger === "manual" ? "manual" : "auto";
				const preTokens = Number(message?.compact_metadata?.pre_tokens ?? 0);
				emit({
					type: "compact-boundary",
					trigger,
					preTokens: Number.isFinite(preTokens) ? preTokens : 0,
				});
			}

			// Stream events: prefer these for real-time deltas (avoids double-emitting full assistant blocks)
			if (message?.type === "stream_event" && message?.event) {
				sawStreamEvents = true;
				const event = message.event;

				if (event.type === "content_block_start") {
					const block = event.content_block;
					const index = event.index;
					if (block?.type === "text" && typeof block?.text === "string" && block.text.length > 0) {
						emit({ type: "assistant-message-delta", content: block.text });
					}
					if (block?.type === "tool_use") {
						const toolName = block.name as string;
						const toolInput = block.input as Record<string, unknown>;
						const toolUseId = block.id as string | undefined;

						if (typeof index === "number" && toolUseId) {
							toolUseIdByStreamIndex.set(index, toolUseId);
						}
						if (toolUseId) {
							toolNameByToolUseId.set(toolUseId, toolName);
							toolInputJsonBufferByToolUseId.delete(toolUseId);
						}

						emit({
							type: "tool-call",
							tool: toolName,
							input: toolInput,
							toolUseId,
							status: "running",
						});

						// Detect subagent invocations via Task tool
						// Per SDK docs, Task tool is used to invoke subagents with subagent_type in input
						if (toolName === "Task") {
							const subagentType = toolInput?.subagent_type as string | undefined;
							if (subagentType) {
								emit({
									type: "subagent-invocation",
									subagentName: subagentType,
									toolUseId,
									prompt: toolInput?.prompt as string | undefined,
									description: toolInput?.description as string | undefined,
								});
							}
						}
					}
				}

				if (event.type === "content_block_delta") {
					const delta = event.delta;
					const deltaType = delta.type as string; // widen for forward-compat (e.g. reasoning_delta)
					if (deltaType === "text_delta" && "text" in delta && typeof delta.text === "string") {
						emit({ type: "assistant-message-delta", content: delta.text });
					} else if (
						(deltaType === "thinking_delta" || deltaType === "reasoning_delta") &&
						"thinking" in delta &&
						typeof delta.thinking === "string"
					) {
						emit({
							type: "thinking-delta",
							content: delta.thinking,
							partId: `thinking_${event.index}`,
						});
					} else if (
						deltaType === "input_json_delta" &&
						"partial_json" in delta &&
						typeof delta.partial_json === "string"
					) {
						const index = event.index;
						const toolUseId = typeof index === "number" ? toolUseIdByStreamIndex.get(index) : undefined;
						if (toolUseId) {
							const nextJson = `${toolInputJsonBufferByToolUseId.get(toolUseId) ?? ""}${delta.partial_json}`;
							toolInputJsonBufferByToolUseId.set(toolUseId, nextJson);

							let parsedInput: Record<string, unknown> | undefined;
							try {
								const parsed = JSON.parse(nextJson);
								if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
									parsedInput = parsed as Record<string, unknown>;
								}
							} catch {
								// partial JSON not complete yet — keep buffering
							}

							const toolName = toolNameByToolUseId.get(toolUseId) ?? "tool";
							emit({
								type: "tool-call",
								tool: toolName,
								input: parsedInput ?? { _partialJson: nextJson },
								toolUseId,
								status: "running",
							});
						}
					}
				}

				if (event.type === "content_block_stop") {
					const index = event.index as number | undefined;
					if (typeof index === "number") {
						const toolUseId = toolUseIdByStreamIndex.get(index);
						if (toolUseId) {
							toolInputJsonBufferByToolUseId.delete(toolUseId);
							toolUseIdByStreamIndex.delete(index);
						}
					}
				}
			}

			// Tool progress signals (long-running tools)
			if (message?.type === "tool_progress") {
				emit({
					type: "tool-call",
					tool: message.tool_name,
					input: {
						elapsedSeconds: message.elapsed_time_seconds,
						// SDK 0.2.87: task_id for correlating progress to background agents
						...(message.task_id ? { taskId: message.task_id } : {}),
					},
					toolUseId: message.tool_use_id,
					status: "running",
				});
			}

			// B9: SDKAssistantMessage.error — surface authentication/billing/rate errors
			if (message?.type === "assistant" && message?.error) {
				emit({
					type: "assistant-error",
					errorType: String(message.error),
				});
			}

			// Full assistant message (fallback if stream events are not emitted)
			if (!sawStreamEvents && message?.type === "assistant") {
				const content = message.message?.content || [];
				for (const block of content) {
					if (block?.type === "text") {
						emit({ type: "assistant-message", content: block.text ?? "" });
					} else if (block?.type === "tool_use") {
						const toolName = block.name as string;
						const toolInput = block.input as Record<string, unknown>;

						emit({
							type: "tool-call",
							tool: toolName,
							input: toolInput,
							toolUseId: block.id,
							status: "running",
						});

						// Detect subagent invocations via Task tool (fallback handler)
						if (toolName === "Task") {
							const subagentType = toolInput?.subagent_type as string | undefined;
							if (subagentType) {
								emit({
									type: "subagent-invocation",
									subagentName: subagentType,
									toolUseId: block.id,
									prompt: toolInput?.prompt as string | undefined,
									description: toolInput?.description as string | undefined,
								});
							}
						}
					}
				}
			}

			// Tool results can surface as "user" messages with tool_result blocks
			// User messages also contain checkpoint UUIDs when file checkpointing is enabled
			if (message?.type === "user") {
				// Emit checkpoint if UUID is present (for file checkpointing/undo support)
				const checkpointUuid = message.uuid as string | undefined;
				if (checkpointUuid && sessionId) {
					emit({
						type: "checkpoint-created",
						sessionId,
						checkpointUuid,
						timestamp: Date.now(),
					});
				}

				const content = message.message?.content || [];
				for (const block of content) {
					if (typeof block === "string") continue;
					if (block?.type === "tool_result") {
						emit({
							type: "tool-result",
							toolUseId: block.tool_use_id,
							result: block.content,
							toolUseResult: (message as SDKUserMessage).tool_use_result,
						});
					}
				}
			}

			// Result / token usage + cost (end of conversation - cumulative totals)
			if (message?.type === "result") {
				if ("result" in message && typeof message.result === "string" && message.result.trim().length > 0) {
					emit({ type: "assistant-message", content: message.result });
				}
				if (message.usage) {
					const modelUsage = normalizeModelUsage(message.modelUsage);
					const contextWindow = pickContextWindow(modelUsage, sdkOptions.model);

					// Extract last message-type iteration for accurate context window usage.
					// usage.iterations has per-API-call breakdowns. The last 'message' iteration
					// reflects the actual current context window occupancy, NOT cumulative totals.
					// See: https://docs.anthropic.com/en/docs/about-claude/models (iterations field)
					let lastIterContextTokens: number | undefined;
					const iterations = message.usage.iterations;
					if (Array.isArray(iterations) && iterations.length > 0) {
						// Walk backwards to find the last message-type iteration (skip compaction iterations)
						for (let i = iterations.length - 1; i >= 0; i--) {
							const iter = iterations[i];
							if (iter && iter.type === "message") {
								lastIterContextTokens =
									(iter.input_tokens ?? 0) +
									(iter.cache_read_input_tokens ?? 0) +
									(iter.cache_creation_input_tokens ?? 0);
								break;
							}
						}
					}

					emit({
						type: "token-usage",
						usage: {
							inputTokens: message.usage.input_tokens,
							outputTokens: message.usage.output_tokens,
							cacheReadTokens: message.usage.cache_read_input_tokens,
							cacheCreationTokens: message.usage.cache_creation_input_tokens,
							...(typeof contextWindow === "number" ? { contextWindow } : {}),
							// Per-turn context tokens from last iteration (actual window occupancy)
							...(typeof lastIterContextTokens === "number" ? { lastIterContextTokens } : {}),
							// SDK newer usage fields
							...(message.usage.cache_creation != null
								? {
										cacheCreation: {
											ephemeral1hInputTokens: message.usage.cache_creation.ephemeral_1h_input_tokens,
											ephemeral5mInputTokens: message.usage.cache_creation.ephemeral_5m_input_tokens,
										},
									}
								: {}),
							...(message.usage.inference_geo != null ? { inferenceGeo: message.usage.inference_geo } : {}),
							...(message.usage.server_tool_use != null
								? {
										serverToolUse: {
											webFetchRequests: message.usage.server_tool_use.web_fetch_requests,
											webSearchRequests: message.usage.server_tool_use.web_search_requests,
										},
									}
								: {}),
							...(message.usage.service_tier != null ? { serviceTier: message.usage.service_tier } : {}),
						},
						// CC SDK: total_cost_usd is on the result message itself, NOT inside usage
						// SDKResultSuccess/SDKResultError both have top-level total_cost_usd
						totalCostUsd: message.total_cost_usd,
						...(modelUsage ? { modelUsage } : {}),
					});
				}

				const errors =
					"errors" in message && Array.isArray(message.errors)
						? message.errors.filter((err: unknown): err is string => typeof err === "string")
						: [];
				const permissionDenials = normalizePermissionDenials(message.permission_denials);

				// B10: emit result-complete with stop_reason + subtype/error metadata
				emit({
					type: "result-complete",
					stopReason: message.stop_reason ?? null,
					numTurns: typeof message.num_turns === "number" ? message.num_turns : undefined,
					durationMs: typeof message.duration_ms === "number" ? message.duration_ms : undefined,
					durationApiMs: typeof message.duration_api_ms === "number" ? message.duration_api_ms : undefined,
					subtype: typeof message.subtype === "string" ? message.subtype : undefined,
					isError: typeof message.is_error === "boolean" ? message.is_error : undefined,
					...(errors.length > 0 ? { errors } : {}),
					...(permissionDenials ? { permissionDenials } : {}),
					...(typeof message.fast_mode_state === "string" ? { fastModeState: message.fast_mode_state } : {}),
					// SDK 0.2.92: terminal reason + deferred tool use
					...(typeof message.terminal_reason === "string" ? { terminalReason: message.terminal_reason } : {}),
					...("deferred_tool_use" in message && message.deferred_tool_use ? { deferredToolUse: message.deferred_tool_use } : {}),
				});

				if ("structured_output" in message && message.structured_output !== undefined) {
					emit({
						type: "structured-output",
						data: message.structured_output,
					});
				}
			}

			const supplementalResult = emitClaudeCodeSupplementalStreamEvents(message, emit, onError);
			if (supplementalResult === "fatal") return;
		}

		if (sessionId) {
			activeSessions.delete(sessionId);
		}
		onComplete(sessionId || "");
	} catch (error) {
		if (sessionId) {
			activeSessions.delete(sessionId);
		}
		onError(error as Error);
	}
}

export async function abortClaudeCode(sessionId: string): Promise<void> {
	const session = activeSessions.get(sessionId);
	if (session) {
		try {
			await session.query?.interrupt();
		} catch {
			// ignore
		}
		session.controller.abort();
		activeSessions.delete(sessionId);
	}
}

export function listActiveSessions(): Array<{
	sessionId: string;
	cwd: string;
	startedAt: number;
}> {
	return Array.from(activeSessions.entries()).map(([sessionId, s]) => ({
		sessionId,
		cwd: s.cwd,
		startedAt: s.startedAt,
	}));
}

/**
 * Rewind files to a previous checkpoint state.
 *
 * This restores files modified by Write/Edit/NotebookEdit tools to their state
 * at the specified checkpoint. The conversation history remains intact.
 *
 * SDK docs pattern (08-file-checkpointing.md):
 *   1. Resume the session with an empty prompt
 *   2. Start iterating the stream (ProcessTransport must be ready)
 *   3. Call rewindFiles() inside the for-await loop on the first message
 *   4. Break out of the loop
 *
 * Calling rewindFiles() before the stream starts can hit
 * "ProcessTransport is not ready for writing" because the CLI subprocess
 * hasn't finished initialising yet.
 *
 * @param sessionId - The session ID to rewind
 * @param checkpointUuid - The checkpoint UUID to rewind to (from user message uuid)
 * @param cwd - Working directory of the session
 * @returns Result with success flag and file change statistics
 */
export async function rewindToCheckpoint(
	sessionId: string,
	checkpointUuid: string,
	cwd: string,
): Promise<{ success: boolean; filesChanged?: string[]; insertions?: number; deletions?: number }> {
	try {
		// Resume the session with an empty prompt to open the connection.
		// SDK requires CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING env var for tracking.
		const resumeOptions: Partial<Options> & { extraArgs?: Record<string, string | null> } = {
			cwd,
			resume: sessionId,
			enableFileCheckpointing: true,
			extraArgs: { "replay-user-messages": null },
			env: {
				...(process.env as Record<string, string | undefined>),
				CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1",
			},
		};

		const q = query({ prompt: "", options: resumeOptions });

		if (typeof q.rewindFiles !== "function") {
			console.error("rewindFiles is not available on the query object — SDK version too old?");
			return { success: false };
		}

		// Per SDK docs: call rewindFiles INSIDE the for-await loop so the
		// ProcessTransport is guaranteed to be ready. Then break immediately.
		let result:
			| { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }
			| undefined;

		for await (const _message of q) {
			// Transport is now ready — safe to call rewindFiles.
			result = await q.rewindFiles(checkpointUuid);
			break;
		}

		if (!result) {
			console.error("rewindFiles: stream ended before first message");
			return { success: false };
		}

		if (!result.canRewind) {
			console.error("Cannot rewind:", result.error);
			return { success: false };
		}

		return {
			success: true,
			filesChanged: result.filesChanged,
			insertions: result.insertions,
			deletions: result.deletions,
		};
	} catch (error) {
		console.error("Failed to rewind to checkpoint:", error);
		return { success: false };
	}
}

/**
 * Stop a running background task (agent teams).
 * Requires an active session with the given sessionId.
 */
export async function stopTask(sessionId: string, taskId: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.stopTask(taskId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reconnect an MCP server by name on an active session.
 */
export async function reconnectMcpServer(sessionId: string, serverName: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.reconnectMcpServer(serverName);
		return true;
	} catch {
		return false;
	}
}

/**
 * Enable or disable an MCP server by name on an active session.
 */
export async function toggleMcpServer(sessionId: string, serverName: string, enabled: boolean): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.toggleMcpServer(serverName, enabled);
		return true;
	} catch {
		return false;
	}
}

/**
 * B1: Change permission mode mid-session via Query.setPermissionMode().
 */
export async function setPermissionMode(sessionId: string, mode: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.setPermissionMode(mode as import("@anthropic-ai/claude-agent-sdk").PermissionMode);
		return true;
	} catch {
		return false;
	}
}

/**
 * B2: Change model mid-session via Query.setModel().
 */
export async function setModel(sessionId: string, model?: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.setModel(model);
		return true;
	} catch {
		return false;
	}
}

/**
 * B3: Get full initialization result (richer than session-init message).
 * Returns commands, models, account info, output styles.
 */
export async function getInitializationResult(sessionId: string): Promise<Record<string, unknown> | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		// SDKControlInitializeResponse is not exported from the SDK package; double-cast
		// is the only option until the SDK exports it or we define a dedicated parsed type.
		return (await session.query.initializationResult()) as unknown as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * B7: Dynamically set MCP servers mid-session via Query.setMcpServers().
 * Returns { added, removed, errors }.
 */
export async function setMcpServers(
	sessionId: string,
	servers: Record<string, unknown>,
): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> } | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		const result = await session.query.setMcpServers(
			servers as Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig>,
		);
		return {
			added: result.added,
			removed: result.removed,
			errors: result.errors,
		};
	} catch {
		return null;
	}
}

/**
 * SDK 0.2.87: Reload plugins on a live session via Query.reloadPlugins().
 * Unlike the filesystem-level cc_reload_plugins, this tells the running SDK process
 * to pick up new/changed plugins and returns refreshed commands, agents, MCP status.
 */
export async function reloadPluginsLive(sessionId: string): Promise<{
	commands: unknown[];
	agents: unknown[];
	plugins: unknown[];
	mcpServers: unknown[];
	errorCount: number;
} | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		const result = await session.query.reloadPlugins();
		return {
			commands: result.commands,
			agents: result.agents,
			plugins: result.plugins,
			mcpServers: result.mcpServers,
			errorCount: result.error_count,
		};
	} catch {
		return null;
	}
}

/**
 * SDK 0.2.87: Get detailed context window usage breakdown.
 * Returns categories, memory files, MCP tools, agents, skills, message breakdown, etc.
 */
export async function getContextUsage(sessionId: string): Promise<Record<string, unknown> | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		const result = await session.query.getContextUsage();
		return result as unknown as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * SDK 0.2.87: Apply settings mid-session (flag settings layer).
 * Merges provided settings into the active configuration.
 */
export async function applySettings(sessionId: string, settings: Record<string, unknown>): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.applyFlagSettings(settings as import("@anthropic-ai/claude-agent-sdk").Settings);
		return true;
	} catch {
		return false;
	}
}

/**
 * SDK 0.2.87: Tag a session. Pass null tag to clear.
 */
export async function tagSession(sessionId: string, tag: string | null, cwd?: string): Promise<boolean> {
	try {
		const { tagSession: sdkTagSession } = await import("@anthropic-ai/claude-agent-sdk");
		await sdkTagSession(sessionId, tag, cwd ? { dir: cwd } : undefined);
		return true;
	} catch {
		return false;
	}
}

export async function checkClaudeCodeAvailable(): Promise<boolean> {
	if (process.env.ANTHROPIC_API_KEY) return true;
	try {
		await stat(CLAUDE_SETTINGS_FILE);
		return true;
	} catch {
		return false;
	}
}

export function checkAvailable(): boolean {
	return !!process.env.ANTHROPIC_API_KEY;
}
