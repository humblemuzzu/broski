import type { StatsScanState, StatsSummary } from "../contract";
import type { StatsQuery } from "../core/ports";
import { PriceBook } from "./pricing";
import { querySummary } from "./query";
import { StatsScanner } from "./scanner";
import { StatsStore } from "./store";
import type { StatsPaths } from "./types";

/**
 * Owns the SQLite ledger, pricing catalog, and incremental scanner. Runs either directly
 * in-process (for tests) or inside the dedicated stats Worker thread (in production).
 */
export class StatsEngine {
	readonly store: StatsStore;
	readonly priceBook: PriceBook;
	readonly scanner: StatsScanner;
	private scanInflight: Promise<{ changed: boolean; parsedFiles: number }> | undefined;
	private scanState: StatsScanState = "fresh";
	private lastScanAt = 0;
	private controller = new AbortController();

	constructor(
		private readonly paths: StatsPaths,
		options?: { readonly disableRemotePricing?: boolean },
	) {
		this.store = new StatsStore(paths.dbPath);
		this.priceBook = new PriceBook({
			cachePath: paths.pricingCachePath,
			disableRemote: options?.disableRemotePricing,
		});
		this.scanner = new StatsScanner(this.store, this.priceBook, paths);
	}

	async scan(refreshPricing = false): Promise<{ changed: boolean; parsedFiles: number }> {
		if (this.scanInflight) return this.scanInflight;
		this.scanState = this.lastScanAt === 0 ? "indexing" : "refreshing";
		this.scanInflight = this.runScan(refreshPricing).finally(() => {
			this.scanInflight = undefined;
			this.scanState = "fresh";
			this.lastScanAt = Date.now();
		});
		return this.scanInflight;
	}

	summary(query: StatsQuery): StatsSummary {
		return querySummary(this.store, this.priceBook, {
			range: query.range,
			...(query.harness !== undefined && { harness: query.harness }),
			...(query.timeZone !== undefined && { timeZone: query.timeZone }),
			scanState: this.scanState,
			sources: this.scanner.progress,
			anchorPath: this.paths.dbPath,
		});
	}

	/**
	 * Serves immediately from SQLite when a scan is already running or fresh; kicks off a
	 * background scan when stale or explicitly requested via `query.refresh`.
	 */
	async readSummary(query: StatsQuery, staleAfterMs = 60_000): Promise<StatsSummary> {
		const now = Date.now();
		const isStale = query.refresh === true || this.lastScanAt === 0 || now - this.lastScanAt >= staleAfterMs;
		if (isStale && !this.scanInflight) {
			if (this.lastScanAt === 0) {
				// First request waits up to 1.5s for the newest files so the first render is populated.
				await Promise.race([
					this.scan(Boolean(query.refresh)),
					new Promise<void>((resolve) => {
						const t = setTimeout(resolve, 1_500);
						t.unref?.();
					}),
				]);
			} else {
				void this.scan(Boolean(query.refresh));
			}
		}
		return this.summary(query);
	}

	dispose(): void {
		this.controller.abort();
		this.store.close();
	}

	private async runScan(refreshPricing: boolean): Promise<{ changed: boolean; parsedFiles: number }> {
		if (refreshPricing || this.priceBook.needsRefresh(Date.now())) {
			const updated = await this.priceBook.refresh(Date.now(), refreshPricing);
			if (updated) this.store.repriceStaleBuckets(this.priceBook);
		}
		const res = await this.scanner.scanAll(this.controller.signal);
		let parsedFiles = 0;
		for (const p of this.scanner.progress.values()) parsedFiles += p.parsedFiles;
		return { changed: res.changed, parsedFiles };
	}
}
