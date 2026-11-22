import { Database } from "bun:sqlite";
import { mkdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import type { StatsCostSource, StatsFingerprint, StatsHarness } from "../contract";
import type { PriceBook } from "./pricing";
import {
	type ContextTier,
	compactDedupKey,
	fnv1a,
	localDayKey,
	type PricedTurn,
	type SourceCursor,
	type SpeedTier,
	type TurnEvent,
	utcHourKey,
} from "./types";

const SCHEMA_VERSION = "2";
const MAX_SPANS_PER_SESSION = 64;
const IDLE_GAP_MS = 10 * 60_000;
const HOURLY_RETENTION_MS = 72 * 3_600_000;

export interface BustInfo {
	readonly bust: boolean;
	readonly idle: boolean;
	readonly bustCostUsd: number;
}

export interface BatchCommit {
	readonly cursors: readonly SourceCursor[];
	readonly dedupUpdates: ReadonlyArray<{
		readonly harness: StatsHarness;
		readonly key: string;
		readonly state: string;
	}>;
	readonly turns: ReadonlyArray<{
		readonly turn: TurnEvent;
		readonly priced: PricedTurn;
		readonly projectId: string;
		readonly projectName: string;
		readonly bust: BustInfo;
	}>;
}

export class StatsStore {
	readonly db: Database;

	private readonly upsertCursor: ReturnType<Database["prepare"]>;
	private readonly upsertDedup: ReturnType<Database["prepare"]>;
	private readonly upsertDaily: ReturnType<Database["prepare"]>;
	private readonly upsertHourly: ReturnType<Database["prepare"]>;
	private readonly upsertSessionDay: ReturnType<Database["prepare"]>;
	private readonly upsertProjectDaily: ReturnType<Database["prepare"]>;
	private readonly upsertSubagent: ReturnType<Database["prepare"]>;
	private readonly getSession: ReturnType<Database["prepare"]>;
	private readonly upsertSession: ReturnType<Database["prepare"]>;

	constructor(dbPath: string) {
		if (dbPath !== ":memory:") {
			mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
		}
		this.db = new Database(dbPath, { create: true });
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA synchronous = NORMAL");
		this.db.run("PRAGMA cache_size = -4000");
		this.db.run("PRAGMA mmap_size = 0");
		this.db.run("PRAGMA temp_store = MEMORY");
		this.db.run("PRAGMA busy_timeout = 3000");
		this.migrate();
		this.upsertCursor = this.db.prepare(
			`INSERT INTO sources (path, harness, dev, ino, mtime_ms, size, offset, guard_hash, status, parser_state)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(path) DO UPDATE SET
			   dev = excluded.dev, ino = excluded.ino, mtime_ms = excluded.mtime_ms,
			   size = excluded.size, offset = excluded.offset, guard_hash = excluded.guard_hash,
			   status = excluded.status, parser_state = excluded.parser_state`,
		);
		this.upsertDedup = this.db.prepare(
			`INSERT INTO dedup (harness, dedup_key, state) VALUES (?, ?, ?)
			 ON CONFLICT(harness, dedup_key) DO UPDATE SET state = excluded.state`,
		);
		this.upsertDaily = this.db.prepare(
			`INSERT INTO turns_daily (
				day, harness, model, provider, speed_tier, context_tier, cost_source, price_sig,
				turns, uncached_input, cached_input, cache_write, cache_write_1h, output, reasoning,
				cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
				speed_premium, cache_savings, duration_ms, timed_output, errors,
				busts, idle_busts, bust_cost, unpriced_turns, unpriced_tokens
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(day, harness, model, provider, speed_tier, context_tier, cost_source, price_sig) DO UPDATE SET
				turns = turns + excluded.turns,
				uncached_input = uncached_input + excluded.uncached_input,
				cached_input = cached_input + excluded.cached_input,
				cache_write = cache_write + excluded.cache_write,
				cache_write_1h = cache_write_1h + excluded.cache_write_1h,
				output = output + excluded.output,
				reasoning = reasoning + excluded.reasoning,
				cost_input = cost_input + excluded.cost_input,
				cost_output = cost_output + excluded.cost_output,
				cost_cache_read = cost_cache_read + excluded.cost_cache_read,
				cost_cache_write = cost_cache_write + excluded.cost_cache_write,
				cost_total = cost_total + excluded.cost_total,
				speed_premium = speed_premium + excluded.speed_premium,
				cache_savings = cache_savings + excluded.cache_savings,
				duration_ms = duration_ms + excluded.duration_ms,
				timed_output = timed_output + excluded.timed_output,
				errors = errors + excluded.errors,
				busts = busts + excluded.busts,
				idle_busts = idle_busts + excluded.idle_busts,
				bust_cost = bust_cost + excluded.bust_cost,
				unpriced_turns = unpriced_turns + excluded.unpriced_turns,
				unpriced_tokens = unpriced_tokens + excluded.unpriced_tokens`,
		);
		this.upsertHourly = this.db.prepare(
			`INSERT INTO turns_hourly (
				hour_key, harness, model, provider, speed_tier, context_tier, cost_source, price_sig,
				turns, uncached_input, cached_input, cache_write, cache_write_1h, output, reasoning,
				cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
				speed_premium, cache_savings, duration_ms, timed_output, errors,
				unpriced_turns, unpriced_tokens
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(hour_key, harness, model, provider, speed_tier, context_tier, cost_source, price_sig) DO UPDATE SET
				turns = turns + excluded.turns,
				uncached_input = uncached_input + excluded.uncached_input,
				cached_input = cached_input + excluded.cached_input,
				cache_write = cache_write + excluded.cache_write,
				cache_write_1h = cache_write_1h + excluded.cache_write_1h,
				output = output + excluded.output,
				reasoning = reasoning + excluded.reasoning,
				cost_input = cost_input + excluded.cost_input,
				cost_output = cost_output + excluded.cost_output,
				cost_cache_read = cost_cache_read + excluded.cost_cache_read,
				cost_cache_write = cost_cache_write + excluded.cost_cache_write,
				cost_total = cost_total + excluded.cost_total,
				speed_premium = speed_premium + excluded.speed_premium,
				cache_savings = cache_savings + excluded.cache_savings,
				duration_ms = duration_ms + excluded.duration_ms,
				timed_output = timed_output + excluded.timed_output,
				errors = errors + excluded.errors,
				unpriced_turns = unpriced_turns + excluded.unpriced_turns,
				unpriced_tokens = unpriced_tokens + excluded.unpriced_tokens`,
		);
		this.upsertSessionDay = this.db.prepare(
			`INSERT OR IGNORE INTO session_days (day, hour_key, harness, session_key, project_id) VALUES (?, ?, ?, ?, ?)`,
		);
		this.upsertProjectDaily = this.db.prepare(
			`INSERT INTO project_daily (day, harness, project_id, project_name, turns, total_tokens, cost_usd, last_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(day, harness, project_id) DO UPDATE SET
			   project_name = CASE WHEN excluded.project_name != 'Unknown' THEN excluded.project_name ELSE project_name END,
			   turns = turns + excluded.turns,
			   total_tokens = total_tokens + excluded.total_tokens,
			   cost_usd = cost_usd + excluded.cost_usd,
			   last_ms = MAX(last_ms, excluded.last_ms)`,
		);
		this.upsertSubagent = this.db.prepare(
			`INSERT INTO subagents_daily (day, harness, agent_name, runs, turns, total_tokens, cost_usd, failures)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(day, harness, agent_name) DO UPDATE SET
			   runs = runs + excluded.runs,
			   turns = turns + excluded.turns,
			   total_tokens = total_tokens + excluded.total_tokens,
			   cost_usd = cost_usd + excluded.cost_usd,
			   failures = failures + excluded.failures`,
		);
		this.getSession = this.db.prepare("SELECT first_ms, last_ms, spans_json FROM sessions WHERE session_key = ?");
		this.upsertSession = this.db.prepare(
			`INSERT INTO sessions (session_key, harness, session_id, project_id, project_name, first_ms, last_ms, active_ms, turns, total_tokens, cost_usd, spans_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(session_key) DO UPDATE SET
			   project_id = CASE WHEN excluded.project_id != 'unknown' THEN excluded.project_id ELSE project_id END,
			   project_name = CASE WHEN excluded.project_name != 'Unknown' THEN excluded.project_name ELSE project_name END,
			   first_ms = MIN(first_ms, excluded.first_ms),
			   last_ms = MAX(last_ms, excluded.last_ms),
			   active_ms = excluded.active_ms,
			   turns = turns + excluded.turns,
			   total_tokens = total_tokens + excluded.total_tokens,
			   cost_usd = cost_usd + excluded.cost_usd,
			   spans_json = excluded.spans_json`,
		);
	}

	close(): void {
		this.db.close(false);
	}

	fingerprint(anchorPath: string): StatsFingerprint {
		const hostId = fnv1a(hostname());
		let volumeId = "local";
		try {
			volumeId = String(statSync(anchorPath).dev);
		} catch {
			// Fall back to host-only fingerprint if anchor path does not exist yet.
		}
		return { hostId, volumeId };
	}

	getCursor(path: string): SourceCursor | undefined {
		const row = this.db
			.query<
				{
					path: string;
					harness: StatsHarness;
					dev: number;
					ino: number;
					mtime_ms: number;
					size: number;
					offset: number;
					guard_hash: string;
					status: "live" | "retained";
					parser_state: string;
				},
				[string]
			>(
				"SELECT path, harness, dev, ino, mtime_ms, size, offset, guard_hash, status, parser_state FROM sources WHERE path = ?",
			)
			.get(path);
		if (!row) return undefined;
		return {
			path: row.path,
			harness: row.harness,
			dev: row.dev,
			ino: row.ino,
			mtimeMs: row.mtime_ms,
			size: row.size,
			offset: row.offset,
			guardHash: row.guard_hash,
			status: row.status,
			parserState: row.parser_state,
		};
	}

	markMissingRetained(harness: StatsHarness, presentPaths: ReadonlySet<string>): void {
		const rows = this.db
			.query<{ path: string }, [string]>("SELECT path FROM sources WHERE harness = ? AND status = 'live'")
			.all(harness);
		const missing = rows.filter((r) => !presentPaths.has(r.path));
		if (missing.length === 0) return;
		const stmt = this.db.prepare("UPDATE sources SET status = 'retained' WHERE path = ?");
		const tx = this.db.transaction((paths: readonly { path: string }[]) => {
			for (const row of paths) stmt.run(row.path);
		});
		tx(missing);
	}

	getDedup(harness: StatsHarness, key: string): string | undefined {
		const compact = compactDedupKey(key);
		const row = this.db
			.query<{ state: string }, [string, string]>("SELECT state FROM dedup WHERE harness = ? AND dedup_key = ?")
			.get(harness, compact);
		return row?.state;
	}

	shrinkMemory(): void {
		this.db.run("PRAGMA shrink_memory");
	}

	firstDayForHarness(harness: StatsHarness): string | undefined {
		const row = this.db
			.query<{ first_day: string | null }, [string]>("SELECT MIN(day) AS first_day FROM turns_daily WHERE harness = ?")
			.get(harness);
		return row?.first_day ?? undefined;
	}

	commitBatch(batch: BatchCommit, now = Date.now()): void {
		const {
			upsertCursor,
			upsertDedup,
			upsertDaily,
			upsertHourly,
			upsertSessionDay,
			upsertProjectDaily,
			upsertSubagent,
			getSession,
			upsertSession,
		} = this;
		const hourlyCutoff = now - HOURLY_RETENTION_MS;
		const sessionSpansCache = new Map<string, Array<[number, number]>>();

		const tx = this.db.transaction(() => {
			for (const c of batch.cursors) {
				upsertCursor.run(
					c.path,
					c.harness,
					c.dev,
					c.ino,
					c.mtimeMs,
					c.size,
					c.offset,
					c.guardHash,
					c.status,
					c.parserState,
				);
			}
			for (const d of batch.dedupUpdates) {
				upsertDedup.run(d.harness, compactDedupKey(d.key), d.state);
			}
			for (const item of batch.turns) {
				const { turn, priced, projectId, projectName, bust } = item;
				const day = localDayKey(turn.ms);
				const hourKey = utcHourKey(turn.ms);
				const turnCount = turn.turnCount ?? (turn.extra ? 0 : 1);
				const t = turn.tokens;
				const totalTokens = t.uncachedInput + t.cachedInput + t.cacheCreation + t.output;
				const unpricedTurns = !turn.extra && priced.unpriced ? turnCount : 0;
				const unpricedTokens = priced.unpriced ? totalTokens : 0;

				upsertDaily.run(
					day,
					turn.harness,
					turn.model,
					turn.provider,
					turn.speedTier,
					priced.contextTier,
					priced.costSource,
					priced.priceSig,
					turnCount,
					t.uncachedInput,
					t.cachedInput,
					t.cacheCreation,
					t.cacheCreation1h,
					t.output,
					t.reasoning,
					priced.inputUsd,
					priced.outputUsd,
					priced.cacheReadUsd,
					priced.cacheWriteUsd,
					priced.totalUsd,
					priced.speedPremiumUsd,
					priced.cacheSavingsUsd,
					turn.durationMs,
					turn.durationMs > 0 ? t.output : 0,
					!turn.extra && turn.error ? 1 : 0,
					bust.bust ? 1 : 0,
					bust.idle ? 1 : 0,
					bust.bustCostUsd,
					unpricedTurns,
					unpricedTokens,
				);

				if (turn.ms >= hourlyCutoff) {
					upsertHourly.run(
						hourKey,
						turn.harness,
						turn.model,
						turn.provider,
						turn.speedTier,
						priced.contextTier,
						priced.costSource,
						priced.priceSig,
						turnCount,
						t.uncachedInput,
						t.cachedInput,
						t.cacheCreation,
						t.cacheCreation1h,
						t.output,
						t.reasoning,
						priced.inputUsd,
						priced.outputUsd,
						priced.cacheReadUsd,
						priced.cacheWriteUsd,
						priced.totalUsd,
						priced.speedPremiumUsd,
						priced.cacheSavingsUsd,
						turn.durationMs,
						turn.durationMs > 0 ? t.output : 0,
						!turn.extra && turn.error ? 1 : 0,
						unpricedTurns,
						unpricedTokens,
					);
				}

				if (turn.sessionKey) {
					upsertSessionDay.run(day, hourKey, turn.harness, turn.sessionKey, projectId);
					let spans = sessionSpansCache.get(turn.sessionKey);
					if (!spans) {
						const existing = getSession.get(turn.sessionKey) as { spans_json: string } | null;
						spans = existing?.spans_json ? parseSpans(existing.spans_json) : [];
						sessionSpansCache.set(turn.sessionKey, spans);
					}
					const activeMs = touchSpans(spans, turn.ms);
					upsertSession.run(
						turn.sessionKey,
						turn.harness,
						turn.sessionId,
						projectId,
						projectName,
						turn.ms,
						turn.ms,
						activeMs,
						turnCount,
						totalTokens,
						priced.totalUsd,
						JSON.stringify(spans),
					);
				}

				if (projectId !== "unknown") {
					upsertProjectDaily.run(
						day,
						turn.harness,
						projectId,
						projectName,
						turnCount,
						totalTokens,
						priced.totalUsd,
						turn.ms,
					);
				}

				if (turn.isSubagent && turn.subagentName) {
					upsertSubagent.run(
						day,
						turn.harness,
						turn.subagentName,
						turn.subagentRunStart ? 1 : 0,
						turnCount,
						totalTokens,
						priced.totalUsd,
						turn.subagentFailed ? 1 : 0,
					);
				}
			}
		});
		tx();
	}

	pruneOldHourly(now = Date.now()): void {
		const cutoff = utcHourKey(now - HOURLY_RETENTION_MS);
		this.db.run("DELETE FROM turns_hourly WHERE hour_key < ?", [cutoff]);
	}

	/**
	 * Re-prices any estimated or previously unpriced rows whose model rate card signature changed.
	 * Runs purely in SQLite without re-reading raw JSONL transcripts.
	 */
	repriceStaleBuckets(priceBook: PriceBook): number {
		let updated = 0;
		for (const table of ["turns_daily", "turns_hourly"] as const) {
			const keyCol = table === "turns_daily" ? "day" : "hour_key";
			const rows = this.db
				.query<
					{
						k: string;
						harness: StatsHarness;
						model: string;
						provider: string;
						speed_tier: SpeedTier;
						context_tier: ContextTier;
						cost_source: StatsCostSource;
						price_sig: string;
						turns: number;
						uncached_input: number;
						cached_input: number;
						cache_write: number;
						cache_write_1h: number;
						output: number;
						reasoning: number;
						duration_ms: number;
						timed_output: number;
						errors: number;
						busts?: number;
						idle_busts?: number;
						bust_cost?: number;
					},
					[]
				>(
					table === "turns_daily"
						? `SELECT day AS k, harness, model, provider, speed_tier, context_tier, cost_source, price_sig,
						          turns, uncached_input, cached_input, cache_write, cache_write_1h, output, reasoning,
						          duration_ms, timed_output, errors, busts, idle_busts, bust_cost
						   FROM turns_daily WHERE cost_source != 'provider_reported'`
						: `SELECT hour_key AS k, harness, model, provider, speed_tier, context_tier, cost_source, price_sig,
						          turns, uncached_input, cached_input, cache_write, cache_write_1h, output, reasoning,
						          duration_ms, timed_output, errors
						   FROM turns_hourly WHERE cost_source != 'provider_reported'`,
				)
				.all();

			const stale = rows.filter((r) => {
				const currentSig = priceBook.lookup(r.provider, r.model)?.sig ?? "none";
				return currentSig !== r.price_sig;
			});
			if (stale.length === 0) continue;

			const del = this.db.prepare(
				`DELETE FROM ${table} WHERE ${keyCol} = ? AND harness = ? AND model = ? AND provider = ? AND speed_tier = ? AND context_tier = ? AND cost_source = ? AND price_sig = ?`,
			);
			const ins = this.db.prepare(
				table === "turns_daily"
					? `INSERT INTO turns_daily (
						day, harness, model, provider, speed_tier, context_tier, cost_source, price_sig,
						turns, uncached_input, cached_input, cache_write, cache_write_1h, output, reasoning,
						cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
						speed_premium, cache_savings, duration_ms, timed_output, errors,
						busts, idle_busts, bust_cost, unpriced_turns, unpriced_tokens
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(day, harness, model, provider, speed_tier, context_tier, cost_source, price_sig) DO UPDATE SET
						turns = turns + excluded.turns,
						uncached_input = uncached_input + excluded.uncached_input,
						cached_input = cached_input + excluded.cached_input,
						cache_write = cache_write + excluded.cache_write,
						cache_write_1h = cache_write_1h + excluded.cache_write_1h,
						output = output + excluded.output,
						reasoning = reasoning + excluded.reasoning,
						cost_input = cost_input + excluded.cost_input,
						cost_output = cost_output + excluded.cost_output,
						cost_cache_read = cost_cache_read + excluded.cost_cache_read,
						cost_cache_write = cost_cache_write + excluded.cost_cache_write,
						cost_total = cost_total + excluded.cost_total,
						speed_premium = speed_premium + excluded.speed_premium,
						cache_savings = cache_savings + excluded.cache_savings,
						duration_ms = duration_ms + excluded.duration_ms,
						timed_output = timed_output + excluded.timed_output,
						errors = errors + excluded.errors,
						busts = busts + excluded.busts,
						idle_busts = idle_busts + excluded.idle_busts,
						bust_cost = bust_cost + excluded.bust_cost,
						unpriced_turns = unpriced_turns + excluded.unpriced_turns,
						unpriced_tokens = unpriced_tokens + excluded.unpriced_tokens`
					: `INSERT INTO turns_hourly (
						hour_key, harness, model, provider, speed_tier, context_tier, cost_source, price_sig,
						turns, uncached_input, cached_input, cache_write, cache_write_1h, output, reasoning,
						cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
						speed_premium, cache_savings, duration_ms, timed_output, errors,
						unpriced_turns, unpriced_tokens
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(hour_key, harness, model, provider, speed_tier, context_tier, cost_source, price_sig) DO UPDATE SET
						turns = turns + excluded.turns,
						uncached_input = uncached_input + excluded.uncached_input,
						cached_input = cached_input + excluded.cached_input,
						cache_write = cache_write + excluded.cache_write,
						cache_write_1h = cache_write_1h + excluded.cache_write_1h,
						output = output + excluded.output,
						reasoning = reasoning + excluded.reasoning,
						cost_input = cost_input + excluded.cost_input,
						cost_output = cost_output + excluded.cost_output,
						cost_cache_read = cost_cache_read + excluded.cost_cache_read,
						cost_cache_write = cost_cache_write + excluded.cost_cache_write,
						cost_total = cost_total + excluded.cost_total,
						speed_premium = speed_premium + excluded.speed_premium,
						cache_savings = cache_savings + excluded.cache_savings,
						duration_ms = duration_ms + excluded.duration_ms,
						timed_output = timed_output + excluded.timed_output,
						errors = errors + excluded.errors,
						unpriced_turns = unpriced_turns + excluded.unpriced_turns,
						unpriced_tokens = unpriced_tokens + excluded.unpriced_tokens`,
			);

			const tx = this.db.transaction(() => {
				for (const r of stale) {
					const priced = priceBook.priceTurn(
						r.provider,
						r.model,
						{
							uncachedInput: r.uncached_input,
							cachedInput: r.cached_input,
							cacheCreation: r.cache_write,
							cacheCreation1h: r.cache_write_1h,
							output: r.output,
							reasoning: r.reasoning,
						},
						r.speed_tier,
						undefined,
						r.context_tier,
					);
					const totalTokens = r.uncached_input + r.cached_input + r.cache_write + r.output;
					del.run(r.k, r.harness, r.model, r.provider, r.speed_tier, r.context_tier, r.cost_source, r.price_sig);
					if (table === "turns_daily") {
						ins.run(
							r.k,
							r.harness,
							r.model,
							r.provider,
							r.speed_tier,
							r.context_tier,
							priced.costSource,
							priced.priceSig,
							r.turns,
							r.uncached_input,
							r.cached_input,
							r.cache_write,
							r.cache_write_1h,
							r.output,
							r.reasoning,
							priced.inputUsd,
							priced.outputUsd,
							priced.cacheReadUsd,
							priced.cacheWriteUsd,
							priced.totalUsd,
							priced.speedPremiumUsd,
							priced.cacheSavingsUsd,
							r.duration_ms,
							r.timed_output,
							r.errors,
							r.busts ?? 0,
							r.idle_busts ?? 0,
							r.bust_cost ?? 0,
							priced.unpriced ? r.turns : 0,
							priced.unpriced ? totalTokens : 0,
						);
					} else {
						ins.run(
							r.k,
							r.harness,
							r.model,
							r.provider,
							r.speed_tier,
							r.context_tier,
							priced.costSource,
							priced.priceSig,
							r.turns,
							r.uncached_input,
							r.cached_input,
							r.cache_write,
							r.cache_write_1h,
							r.output,
							r.reasoning,
							priced.inputUsd,
							priced.outputUsd,
							priced.cacheReadUsd,
							priced.cacheWriteUsd,
							priced.totalUsd,
							priced.speedPremiumUsd,
							priced.cacheSavingsUsd,
							r.duration_ms,
							r.timed_output,
							r.errors,
							priced.unpriced ? r.turns : 0,
							priced.unpriced ? totalTokens : 0,
						);
					}
					updated++;
				}
			});
			tx();
		}
		return updated;
	}

	private migrate(): void {
		this.db.run(`
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS sources (
				path TEXT PRIMARY KEY,
				harness TEXT NOT NULL,
				dev INTEGER NOT NULL,
				ino INTEGER NOT NULL,
				mtime_ms REAL NOT NULL,
				size INTEGER NOT NULL,
				offset INTEGER NOT NULL,
				guard_hash TEXT NOT NULL,
				status TEXT NOT NULL,
				parser_state TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_sources_harness ON sources(harness, status);
			CREATE TABLE IF NOT EXISTS dedup (
				harness TEXT NOT NULL,
				dedup_key TEXT NOT NULL,
				state TEXT NOT NULL,
				PRIMARY KEY (harness, dedup_key)
			);
			CREATE TABLE IF NOT EXISTS turns_daily (
				day TEXT NOT NULL,
				harness TEXT NOT NULL,
				model TEXT NOT NULL,
				provider TEXT NOT NULL,
				speed_tier TEXT NOT NULL,
				context_tier TEXT NOT NULL,
				cost_source TEXT NOT NULL,
				price_sig TEXT NOT NULL,
				turns INTEGER NOT NULL,
				uncached_input INTEGER NOT NULL,
				cached_input INTEGER NOT NULL,
				cache_write INTEGER NOT NULL,
				cache_write_1h INTEGER NOT NULL,
				output INTEGER NOT NULL,
				reasoning INTEGER NOT NULL,
				cost_input REAL NOT NULL,
				cost_output REAL NOT NULL,
				cost_cache_read REAL NOT NULL,
				cost_cache_write REAL NOT NULL,
				cost_total REAL NOT NULL,
				speed_premium REAL NOT NULL,
				cache_savings REAL NOT NULL,
				duration_ms INTEGER NOT NULL,
				timed_output INTEGER NOT NULL,
				errors INTEGER NOT NULL,
				busts INTEGER NOT NULL,
				idle_busts INTEGER NOT NULL,
				bust_cost REAL NOT NULL,
				unpriced_turns INTEGER NOT NULL,
				unpriced_tokens INTEGER NOT NULL,
				PRIMARY KEY (day, harness, model, provider, speed_tier, context_tier, cost_source, price_sig)
			);
			CREATE INDEX IF NOT EXISTS idx_turns_daily_day ON turns_daily(day);
			CREATE TABLE IF NOT EXISTS turns_hourly (
				hour_key TEXT NOT NULL,
				harness TEXT NOT NULL,
				model TEXT NOT NULL,
				provider TEXT NOT NULL,
				speed_tier TEXT NOT NULL,
				context_tier TEXT NOT NULL,
				cost_source TEXT NOT NULL,
				price_sig TEXT NOT NULL,
				turns INTEGER NOT NULL,
				uncached_input INTEGER NOT NULL,
				cached_input INTEGER NOT NULL,
				cache_write INTEGER NOT NULL,
				cache_write_1h INTEGER NOT NULL,
				output INTEGER NOT NULL,
				reasoning INTEGER NOT NULL,
				cost_input REAL NOT NULL,
				cost_output REAL NOT NULL,
				cost_cache_read REAL NOT NULL,
				cost_cache_write REAL NOT NULL,
				cost_total REAL NOT NULL,
				speed_premium REAL NOT NULL,
				cache_savings REAL NOT NULL,
				duration_ms INTEGER NOT NULL,
				timed_output INTEGER NOT NULL,
				errors INTEGER NOT NULL,
				unpriced_turns INTEGER NOT NULL,
				unpriced_tokens INTEGER NOT NULL,
				PRIMARY KEY (hour_key, harness, model, provider, speed_tier, context_tier, cost_source, price_sig)
			);
			CREATE TABLE IF NOT EXISTS sessions (
				session_key TEXT PRIMARY KEY,
				harness TEXT NOT NULL,
				session_id TEXT NOT NULL,
				project_id TEXT NOT NULL,
				project_name TEXT NOT NULL,
				first_ms INTEGER NOT NULL,
				last_ms INTEGER NOT NULL,
				active_ms INTEGER NOT NULL,
				turns INTEGER NOT NULL,
				total_tokens INTEGER NOT NULL,
				cost_usd REAL NOT NULL,
				spans_json TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS session_days (
				day TEXT NOT NULL,
				hour_key TEXT NOT NULL,
				harness TEXT NOT NULL,
				session_key TEXT NOT NULL,
				project_id TEXT NOT NULL,
				PRIMARY KEY (day, hour_key, harness, session_key)
			);
			CREATE INDEX IF NOT EXISTS idx_session_days_day ON session_days(day, harness);
			CREATE TABLE IF NOT EXISTS project_daily (
				day TEXT NOT NULL,
				harness TEXT NOT NULL,
				project_id TEXT NOT NULL,
				project_name TEXT NOT NULL,
				turns INTEGER NOT NULL,
				total_tokens INTEGER NOT NULL,
				cost_usd REAL NOT NULL,
				last_ms INTEGER NOT NULL,
				PRIMARY KEY (day, harness, project_id)
			);
			CREATE TABLE IF NOT EXISTS subagents_daily (
				day TEXT NOT NULL,
				harness TEXT NOT NULL,
				agent_name TEXT NOT NULL,
				runs INTEGER NOT NULL,
				turns INTEGER NOT NULL,
				total_tokens INTEGER NOT NULL,
				cost_usd REAL NOT NULL,
				failures INTEGER NOT NULL,
				PRIMARY KEY (day, harness, agent_name)
			);
		`);
		this.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [SCHEMA_VERSION]);
	}
}

function parseSpans(json: string): Array<[number, number]> {
	try {
		const raw = JSON.parse(json) as unknown;
		if (!Array.isArray(raw)) return [];
		return raw.filter((s): s is [number, number] => Array.isArray(s) && s.length === 2);
	} catch {
		return [];
	}
}

function touchSpans(spans: Array<[number, number]>, ms: number): number {
	const open = spans.at(-1);
	if (open && ms >= open[0] && ms - open[1] <= IDLE_GAP_MS) {
		open[1] = Math.max(open[1], ms);
	} else {
		spans.push([ms, ms]);
		if (spans.length > MAX_SPANS_PER_SESSION) {
			spans.splice(0, spans.length - MAX_SPANS_PER_SESSION);
		}
	}
	let total = 0;
	for (const [a, b] of spans) total += Math.max(0, b - a);
	return total;
}
