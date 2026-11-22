import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { StatsHarness } from "../contract";
import type { PriceBook } from "./pricing";
import { ProjectResolver } from "./projects";
import { scanAntigravity } from "./sources/antigravity";
import { type ClaudeParserState, initClaudeState, parseClaudeLine, parseClaudeStatsArchive } from "./sources/claude";
import { type CodexParserState, initCodexState, parseCodexLine } from "./sources/codex";
import { parseGeminiSessionFile } from "./sources/gemini";
import { parseGrokLine } from "./sources/grok";
import { scanOpencode } from "./sources/opencode";
import { createParentExistsCache, type PiParserState, parsePiLine } from "./sources/pi";
import type { BustInfo, StatsStore } from "./store";
import { canResumeFile, streamJsonl, walkFiles, yieldSlice } from "./stream";
import { HARNESSES, type SourceCursor, type SourceProgress, type StatsPaths, type TurnEvent } from "./types";

const COMMIT_EVERY_FILES = 15;
const MAX_BATCH_TURNS = 500;
const MAX_BATCH_DEDUP = 2_000;
const MAX_PREV_TURNS = 256;
const SLICE_MS = 100;
const SLICE_BYTES = 16 * 1024 * 1024;
const BUST_MIN_CONTEXT = 20_000;
const CACHE_TTL_5M_MS = 5 * 60_000;
const CACHE_TTL_1H_MS = 60 * 60_000;

interface PrevTurnMemory {
	ms: number;
	context: number;
	model: string;
	ttlMs: number;
}

export function defaultStatsPaths(piAgentDir: string, broskiDir: string): StatsPaths {
	const home = process.env.HOME || homedir();
	const claudeEnv =
		process.env.CLAUDE_CONFIG_DIRS?.split(",")
			.map((s) => s.trim())
			.filter(Boolean) ?? [];
	const claudeSingle = process.env.CLAUDE_CONFIG_DIR?.trim();
	const claudeDirs = [
		...new Set([
			...claudeEnv.map((d) => join(d, "projects")),
			...(claudeSingle ? [join(claudeSingle, "projects")] : []),
			join(home, ".claude", "projects"),
			join(home, ".config", "claude", "projects"),
			join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions"),
		]),
	];
	const claudeRoot = claudeSingle || join(home, ".claude");
	const xdgData = process.env.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
	const piSessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR?.trim() || join(piAgentDir, "sessions");
	return {
		dbPath: join(broskiDir, "stats", "stats.sqlite"),
		pricingCachePath: join(broskiDir, "stats", "pricing-cache.json"),
		piSessionsDir,
		claudeDirs,
		claudeStatsCachePath: join(claudeRoot, "stats-cache.json"),
		codexHome: process.env.CODEX_HOME?.trim() || join(home, ".codex"),
		opencodeHome: process.env.OPENCODE_DATA_DIR?.trim() || join(xdgData, "opencode"),
		antigravityDirs: [
			join(home, ".gemini", "antigravity"),
			join(home, ".gemini", "antigravity-cli"),
			join(home, ".gemini", "antigravity-ide"),
			join(home, ".config", "antigravity"),
		],
		grokHome: process.env.GROK_HOME?.trim() || join(home, ".grok"),
		geminiHome: join(home, ".gemini", "tmp"),
	};
}

export class StatsScanner {
	private readonly projects = new ProjectResolver();
	private readonly prevTurns = new Map<string, PrevTurnMemory>();
	readonly progress = new Map<StatsHarness, SourceProgress>();

	constructor(
		private readonly store: StatsStore,
		private readonly priceBook: PriceBook,
		private readonly paths: StatsPaths,
	) {
		for (const h of HARNESSES) {
			this.progress.set(h, { harness: h, state: "fresh", files: 0, parsedFiles: 0, bytesRead: 0, totalBytes: 0 });
		}
	}

	async scanAll(signal?: AbortSignal): Promise<{ changed: boolean }> {
		let changed = false;
		// Order matters for cross-agent mirror suppression: Claude/Codex/OpenCode first, then Pi.
		if (await this.scanJsonlHarness("claude", signal)) changed = true;
		if (await this.scanClaudeArchive(signal)) changed = true;
		if (await this.scanJsonlHarness("codex", signal)) changed = true;
		if (await this.scanOpencodeSource(signal)) changed = true;
		if (await this.scanJsonlHarness("pi", signal)) changed = true;
		if (await this.scanAntigravitySource(signal)) changed = true;
		if (await this.scanJsonlHarness("grok", signal)) changed = true;
		if (await this.scanGeminiSource(signal)) changed = true;
		this.store.pruneOldHourly();
		if (changed) {
			this.store.shrinkMemory();
			Bun.gc(false);
		}
		return { changed };
	}

	private async scanJsonlHarness(harness: "claude" | "codex" | "pi" | "grok", signal?: AbortSignal): Promise<boolean> {
		const prog = this.progress.get(harness);
		if (!prog) return false;
		const files = await this.discoverJsonlFiles(harness);
		prog.files = files.length;
		prog.parsedFiles = 0;
		prog.bytesRead = 0;
		prog.totalBytes = 0;
		prog.problem = undefined;
		if (files.length === 0) {
			prog.state = "fresh";
			return false;
		}
		prog.state = "refreshing";

		const present = new Set(files);
		const work: Array<{
			path: string;
			dev: number;
			ino: number;
			mtimeMs: number;
			size: number;
			cursor: SourceCursor | undefined;
			resume: boolean;
		}> = [];

		for (const filePath of files) {
			if (signal?.aborted) return false;
			const st = await stat(filePath).catch(() => undefined);
			if (!st) continue;
			const cursor = this.store.getCursor(filePath);
			if (
				cursor &&
				cursor.status === "live" &&
				cursor.dev === st.dev &&
				cursor.ino === st.ino &&
				cursor.mtimeMs === st.mtimeMs &&
				cursor.size === st.size
			) {
				continue;
			}
			const sameInode = cursor && cursor.dev === st.dev && cursor.ino === st.ino;
			const resume = Boolean(
				sameInode &&
					!filePath.endsWith(".zst") &&
					cursor &&
					(await canResumeFile(filePath, cursor.offset, st.size, cursor.guardHash)),
			);
			const pendingBytes = resume && cursor ? Math.max(0, st.size - cursor.offset) : st.size;
			prog.totalBytes += pendingBytes;
			work.push({ path: filePath, dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, size: st.size, cursor, resume });
		}

		// Newest files first so recent windows become current within seconds during a cold backfill.
		work.sort((a, b) => b.mtimeMs - a.mtimeMs);
		if (work.length > 50) prog.state = "indexing";

		const parentExists = createParentExistsCache();
		let batch = emptyBatch();
		let sliceStart = performance.now();
		let sliceBytes = 0;
		let changed = false;

		for (let i = 0; i < work.length; i++) {
			if (signal?.aborted) break;
			const item = work[i];
			if (!item) continue;
			const startOffset = item.resume && item.cursor ? item.cursor.offset : 0;
			const dedupLocal = new Map<string, string>();

			let currentOffset = startOffset;
			let parserState: unknown;
			try {
				const parsed =
					item.resume && item.cursor?.parserState ? (JSON.parse(item.cursor.parserState) as unknown) : undefined;
				parserState = parsed ?? initialStateFor(harness, item.path);
			} catch {
				parserState = initialStateFor(harness, item.path);
			}

			const flushIfFull = (): void => {
				if (batch.turns.length >= MAX_BATCH_TURNS || batch.dedupUpdates.length >= MAX_BATCH_DEDUP) {
					// Checkpoint current line cursor alongside mid-file turns so a crash never double-counts.
					if (!item.path.endsWith(".zst") && currentOffset > startOffset) {
						batch.cursors.push({
							path: item.path,
							harness,
							dev: item.dev,
							ino: item.ino,
							mtimeMs: item.mtimeMs,
							size: item.size,
							offset: currentOffset,
							guardHash: "",
							status: "live",
							parserState: JSON.stringify(parserState),
						});
					}
					this.store.commitBatch(batch);
					batch = emptyBatch();
					dedupLocal.clear();
				}
			};
			const getDedup = (h: StatsHarness, k: string): string | undefined => {
				const lk = `${h}\0${k}`;
				if (dedupLocal.has(lk)) return dedupLocal.get(lk);
				return this.store.getDedup(h, k);
			};
			const setDedup = (h: StatsHarness, k: string, s: string): void => {
				dedupLocal.set(`${h}\0${k}`, s);
				batch.dedupUpdates.push({ harness: h, key: k, state: s });
				flushIfFull();
			};
			const emitTurn = (turn: TurnEvent, dedupKey?: string): void => {
				if (dedupKey) setDedup(turn.harness, dedupKey, "1");
				this.recordTurnIntoBatch(batch, turn);
				flushIfFull();
			};

			try {
				const streamRes = await streamJsonl(
					item.path,
					startOffset,
					(line, nextOffset) => {
						currentOffset = nextOffset;
						if (harness === "pi") {
							parsePiLine(parserState as PiParserState, line, {
								sourcePath: item.path,
								parentExists,
								hasDedup: (h, k) => getDedup(h, k) !== undefined,
								emitTurn,
							});
						} else if (harness === "claude") {
							parseClaudeLine(parserState as ClaudeParserState, line, {
								sourcePath: item.path,
								getDedup: (k) => getDedup("claude", k),
								setDedup: (k, s) => setDedup("claude", k, s),
								emitTurn: (t) => emitTurn(t),
							});
						} else if (harness === "codex") {
							parseCodexLine(parserState as CodexParserState, line, {
								sourcePath: item.path,
								hasDedup: (k) => getDedup("codex", k) !== undefined,
								setDedup: (k) => setDedup("codex", k, "1"),
								emitTurn: (t) => emitTurn(t),
							});
						} else {
							parseGrokLine(line, {
								sourcePath: item.path,
								hasDedup: (k) => getDedup("grok", k) !== undefined,
								setDedup: (k) => setDedup("grok", k, "1"),
								emitTurn: (t) => emitTurn(t),
							});
						}
					},
					signal,
				);
				if (signal?.aborted) break;
				batch.cursors.push({
					path: item.path,
					harness,
					dev: item.dev,
					ino: item.ino,
					mtimeMs: item.mtimeMs,
					size: item.size,
					offset: streamRes.offset,
					guardHash: streamRes.guardHash,
					status: "live",
					parserState: JSON.stringify(parserState),
				});
				prog.parsedFiles++;
				prog.bytesRead += streamRes.bytesRead;
				sliceBytes += streamRes.bytesRead;
				changed = true;
			} catch (err) {
				prog.problem = err instanceof Error ? err.message.slice(0, 160) : String(err);
			}

			if (batch.cursors.length >= COMMIT_EVERY_FILES || i === work.length - 1) {
				this.store.commitBatch(batch);
				batch = emptyBatch();
			}
			if (performance.now() - sliceStart >= SLICE_MS || sliceBytes >= SLICE_BYTES) {
				await yieldSlice(8);
				sliceStart = performance.now();
				sliceBytes = 0;
			}
		}

		if (batch.cursors.length > 0 || batch.turns.length > 0) this.store.commitBatch(batch);
		if (!signal?.aborted) this.store.markMissingRetained(harness, present);
		prog.state = "fresh";
		return changed;
	}

	private async scanClaudeArchive(signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted || !existsSync(this.paths.claudeStatsCachePath)) return false;
		const st = await stat(this.paths.claudeStatsCachePath).catch(() => undefined);
		if (!st) return false;
		const cursor = this.store.getCursor(this.paths.claudeStatsCachePath);
		if (cursor && cursor.size === st.size && cursor.mtimeMs === st.mtimeMs) return false;
		const firstDay = this.store.firstDayForHarness("claude");
		const turns = parseClaudeStatsArchive(this.paths.claudeStatsCachePath, firstDay);
		const batch = emptyBatch();
		for (const turn of turns) this.recordTurnIntoBatch(batch, turn);
		batch.cursors.push({
			path: this.paths.claudeStatsCachePath,
			harness: "claude",
			dev: st.dev,
			ino: st.ino,
			mtimeMs: st.mtimeMs,
			size: st.size,
			offset: st.size,
			guardHash: "",
			status: "live",
			parserState: "{}",
		});
		this.store.commitBatch(batch);
		return turns.length > 0;
	}

	private async scanOpencodeSource(signal?: AbortSignal): Promise<boolean> {
		const prog = this.progress.get("opencode");
		if (!prog || signal?.aborted) return false;
		if (!existsSync(this.paths.opencodeHome)) {
			prog.files = 0;
			prog.state = "fresh";
			return false;
		}
		prog.state = "refreshing";
		let batch = emptyBatch();
		const localDedup = new Map<string, string>();
		const flush = (): void => {
			if (batch.turns.length === 0 && batch.dedupUpdates.length === 0) return;
			this.store.commitBatch(batch);
			batch = emptyBatch();
			localDedup.clear();
		};
		const res = scanOpencode(this.paths.opencodeHome, {
			getWatermark: (k) => this.store.getDedup("opencode", k),
			setWatermark: (k, v) => batch.dedupUpdates.push({ harness: "opencode", key: k, state: v }),
			hasDedup: (h, k) => localDedup.has(`${h}\0${k}`) || this.store.getDedup(h, k) !== undefined,
			setDedup: (h, k) => {
				localDedup.set(`${h}\0${k}`, "1");
				batch.dedupUpdates.push({ harness: h, key: k, state: "1" });
			},
			emitTurn: (t) => this.recordTurnIntoBatch(batch, t),
			flush,
		});
		flush();
		prog.files = res.files;
		prog.parsedFiles = res.parsed;
		prog.bytesRead = res.bytes;
		prog.totalBytes = res.bytes;
		prog.state = "fresh";
		return res.parsed > 0;
	}

	private async scanAntigravitySource(signal?: AbortSignal): Promise<boolean> {
		const prog = this.progress.get("antigravity");
		if (!prog || signal?.aborted) return false;
		prog.state = "refreshing";
		let batch = emptyBatch();
		const localDedup = new Set<string>();
		const flush = (): void => {
			if (batch.turns.length === 0 && batch.dedupUpdates.length === 0) return;
			this.store.commitBatch(batch);
			batch = emptyBatch();
			localDedup.clear();
		};
		const res = scanAntigravity(this.paths.antigravityDirs, {
			getWatermark: (k) => this.store.getDedup("antigravity", k),
			setWatermark: (k, v) => batch.dedupUpdates.push({ harness: "antigravity", key: k, state: v }),
			hasDedup: (k) => localDedup.has(k) || this.store.getDedup("antigravity", k) !== undefined,
			setDedup: (k) => {
				localDedup.add(k);
				batch.dedupUpdates.push({ harness: "antigravity", key: k, state: "1" });
			},
			emitTurn: (t) => this.recordTurnIntoBatch(batch, t),
			flush,
		});
		flush();
		prog.files = res.files;
		prog.parsedFiles = res.parsed;
		prog.bytesRead = res.bytes;
		prog.totalBytes = res.bytes;
		prog.state = "fresh";
		return res.parsed > 0;
	}

	private async scanGeminiSource(signal?: AbortSignal): Promise<boolean> {
		const prog = this.progress.get("gemini");
		if (!prog || signal?.aborted || !existsSync(this.paths.geminiHome)) {
			if (prog) prog.state = "fresh";
			return false;
		}
		const files = await walkFiles([this.paths.geminiHome], (f) => f.includes("/chats/") && f.endsWith(".json"));
		prog.files = files.length;
		prog.parsedFiles = 0;
		prog.state = files.length > 0 ? "refreshing" : "fresh";
		const batch = emptyBatch();
		const localDedup = new Set<string>();
		let changed = false;

		for (const filePath of files) {
			if (signal?.aborted) break;
			const st = await stat(filePath).catch(() => undefined);
			if (!st) continue;
			const cursor = this.store.getCursor(filePath);
			if (cursor && cursor.size === st.size && cursor.mtimeMs === st.mtimeMs) continue;
			parseGeminiSessionFile({
				sourcePath: filePath,
				hasDedup: (k) => localDedup.has(k) || this.store.getDedup("gemini", k) !== undefined,
				setDedup: (k) => {
					localDedup.add(k);
					batch.dedupUpdates.push({ harness: "gemini", key: k, state: "1" });
				},
				emitTurn: (t) => this.recordTurnIntoBatch(batch, t),
			});
			batch.cursors.push({
				path: filePath,
				harness: "gemini",
				dev: st.dev,
				ino: st.ino,
				mtimeMs: st.mtimeMs,
				size: st.size,
				offset: st.size,
				guardHash: "",
				status: "live",
				parserState: "{}",
			});
			prog.parsedFiles++;
			changed = true;
		}
		if (batch.cursors.length > 0 || batch.turns.length > 0) this.store.commitBatch(batch);
		prog.state = "fresh";
		return changed;
	}

	private async discoverJsonlFiles(harness: "claude" | "codex" | "pi" | "grok"): Promise<string[]> {
		if (harness === "pi") {
			return walkFiles([this.paths.piSessionsDir], (f) => f.endsWith(".jsonl"));
		}
		if (harness === "claude") {
			const existing = this.paths.claudeDirs.filter(existsSync);
			return walkFiles(
				existing,
				(f) => (f.endsWith(".jsonl") || f.endsWith(".jsonl.zst")) && basename(f) !== "journal.jsonl",
			);
		}
		if (harness === "codex") {
			const active = await walkFiles([join(this.paths.codexHome, "sessions")], isCodexRollout);
			const archived = await walkFiles([join(this.paths.codexHome, "archived_sessions")], isCodexRollout);
			// Plain .jsonl wins over .jsonl.zst and active sessions/ wins over archived_sessions/.
			const byStem = new Map<string, string>();
			for (const list of [active, archived]) {
				for (const f of list) {
					const stem = basename(f).replace(/\.zst$/, "");
					const existing = byStem.get(stem);
					if (!existing || (existing.endsWith(".zst") && !f.endsWith(".zst"))) byStem.set(stem, f);
				}
			}
			return [...byStem.values()];
		}
		return walkFiles([join(this.paths.grokHome, "sessions")], (f) => basename(f) === "updates.jsonl");
	}

	private recordTurnIntoBatch(batch: MutableBatch, turn: TurnEvent): void {
		const priced = this.priceBook.priceTurn(
			turn.provider,
			turn.model,
			turn.tokens,
			turn.speedTier,
			turn.reportedCostUsd,
			turn.aggregate ? "base" : undefined,
		);
		if (priced.unpriced) this.priceBook.maybeRefreshForUnknown(turn.model);
		const project = this.projects.resolve(turn.cwd);
		const bust = this.detectCacheBust(turn, priced.cacheWriteUsd);
		batch.turns.push({ turn, priced, projectId: project.id, projectName: project.name, bust });
	}

	private detectCacheBust(turn: TurnEvent, cacheWriteUsd: number): BustInfo {
		if (turn.extra || turn.isSubagent || !turn.sessionKey) {
			return { bust: false, idle: false, bustCostUsd: 0 };
		}
		const context = turn.tokens.uncachedInput + turn.tokens.cachedInput + turn.tokens.cacheCreation;
		const prev = this.prevTurns.get(turn.sessionKey);
		const isBust =
			Boolean(prev) &&
			!turn.afterCompaction &&
			prev !== undefined &&
			prev.model === turn.model &&
			prev.context >= BUST_MIN_CONTEXT &&
			context > 0 &&
			turn.tokens.cacheCreation >= 0.5 * context &&
			turn.tokens.cachedInput < 0.5 * prev.context;
		const idle = Boolean(isBust && prev && turn.ms - prev.ms > prev.ttlMs);
		if (context > 0) {
			if (this.prevTurns.size >= MAX_PREV_TURNS && !this.prevTurns.has(turn.sessionKey)) {
				const oldest = this.prevTurns.keys().next().value;
				if (oldest !== undefined) this.prevTurns.delete(oldest);
			}
			this.prevTurns.set(turn.sessionKey, {
				ms: turn.ms,
				context,
				model: turn.model,
				ttlMs: turn.tokens.cacheCreation1h > 0 ? CACHE_TTL_1H_MS : CACHE_TTL_5M_MS,
			});
		}
		return { bust: isBust, idle, bustCostUsd: isBust ? cacheWriteUsd : 0 };
	}
}

interface MutableBatch {
	cursors: SourceCursor[];
	dedupUpdates: Array<{ harness: StatsHarness; key: string; state: string }>;
	turns: Array<{
		turn: TurnEvent;
		priced: import("./types").PricedTurn;
		projectId: string;
		projectName: string;
		bust: BustInfo;
	}>;
}

function emptyBatch(): MutableBatch {
	return { cursors: [], dedupUpdates: [], turns: [] };
}

function isCodexRollout(path: string): boolean {
	const name = basename(path);
	return name.startsWith("rollout-") && (name.endsWith(".jsonl") || name.endsWith(".jsonl.zst"));
}

function initialStateFor(harness: "claude" | "codex" | "pi" | "grok", filePath: string): unknown {
	if (harness === "claude") return initClaudeState(filePath);
	if (harness === "codex") return initCodexState();
	return {};
}
