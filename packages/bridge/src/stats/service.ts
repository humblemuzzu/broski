import type { StatsSummaryResult } from "../contract";
import type { StatsQuery, StatsReader } from "../core/ports";
import { defaultStatsPaths } from "./scanner";
import type { StatsPaths } from "./types";
import type { WorkerRequest, WorkerResponse } from "./worker";

const ACTIVE_INTERVAL_MS = 2 * 60_000;
const IDLE_INTERVAL_MS = 15 * 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const POST_ACTIVITY_DEBOUNCE_MS = 2_000;
const RECYCLE_AFTER_FILES = 50;

export interface SampledStats extends StatsReader {
	/** Starts adaptive background scanning and returns a stop/dispose handle. */
	start(): () => void;
	/** Called when a hosted agent finishes a run to schedule a debounced incremental scan. */
	notifyActivity(): void;
	dispose(): Promise<void>;
}

interface PendingCall {
	readonly resolve: (value: WorkerResponse) => void;
	readonly reject: (reason: Error) => void;
}

/**
 * Bridge-side stats service backed by a single dedicated Bun Worker thread so scanning
 * and SQLite I/O never block the bridge's live event loop.
 */
export function machineStats(
	piAgentDir: string,
	broskiDir: string,
	log: (message: string) => void,
	customPaths?: StatsPaths,
	options?: { readonly disableRemotePricing?: boolean },
): SampledStats {
	const paths = customPaths ?? defaultStatsPaths(piAgentDir, broskiDir);
	let worker: Worker | undefined;
	let nextId = 1;
	const pending = new Map<number, PendingCall>();
	const inflightSummaries = new Map<string, Promise<StatsSummaryResult>>();
	let initPromise: Promise<void> | undefined;
	let lastViewedAt = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let periodicTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	function failAllPending(reason: string): void {
		for (const slot of pending.values()) slot.resolve({ id: 0, ok: false, error: reason });
		pending.clear();
	}

	function ensureWorker(): Promise<void> {
		if (initPromise) return initPromise;
		const task = (async () => {
			const w = new Worker(new URL("./worker.ts", import.meta.url).href);
			w.onmessage = (event: MessageEvent<WorkerResponse>) => {
				const res = event.data;
				const slot = pending.get(res.id);
				if (!slot) return;
				pending.delete(res.id);
				slot.resolve(res);
			};
			w.onerror = (event) => {
				log(`[stats] worker error: ${event.message}`);
				if (worker === w) {
					worker = undefined;
					initPromise = undefined;
				}
				failAllPending(event.message || "stats worker failed");
			};
			worker = w;
			const res = await send({ op: "init", paths, disableRemotePricing: options?.disableRemotePricing });
			if (!res.ok) throw new Error(res.error);
		})().catch((err) => {
			initPromise = undefined;
			worker?.terminate();
			worker = undefined;
			throw err;
		});
		initPromise = task;
		return task;
	}

	function send(
		body:
			| Omit<Extract<WorkerRequest, { op: "init" }>, "id">
			| Omit<Extract<WorkerRequest, { op: "summary" }>, "id">
			| Omit<Extract<WorkerRequest, { op: "scan" }>, "id">
			| Omit<Extract<WorkerRequest, { op: "dispose" }>, "id">,
	): Promise<WorkerResponse> {
		const w = worker;
		if (!w || disposed) return Promise.resolve({ id: 0, ok: false, error: "stats service stopped" });
		const id = nextId++;
		return new Promise<WorkerResponse>((resolve, reject) => {
			pending.set(id, { resolve, reject });
			w.postMessage({ id, ...body });
		});
	}

	function schedulePeriodic(): void {
		if (disposed) return;
		if (periodicTimer) clearTimeout(periodicTimer);
		const delay = Date.now() - lastViewedAt < ACTIVE_WINDOW_MS ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
		periodicTimer = setTimeout(() => {
			periodicTimer = undefined;
			void triggerScan(false).finally(() => schedulePeriodic());
		}, delay);
		periodicTimer.unref?.();
	}

	async function recycleWorkerIfIdle(): Promise<void> {
		if (disposed || !worker || pending.size > 0 || inflightSummaries.size > 0) return;
		const old = worker;
		await Promise.race([
			send({ op: "dispose" }),
			new Promise<void>((resolve) => {
				const t = setTimeout(resolve, 1_500);
				t.unref?.();
			}),
		]);
		if (worker === old) {
			worker = undefined;
			initPromise = undefined;
		}
		old.terminate();
	}

	async function triggerScan(refreshPricing: boolean): Promise<void> {
		if (disposed) return;
		try {
			await ensureWorker();
			const res = await send({ op: "scan", refreshPricing });
			if (res.ok && (res.parsedFiles ?? 0) >= RECYCLE_AFTER_FILES) {
				await recycleWorkerIfIdle();
			}
		} catch (error) {
			log(`[stats] background scan failed: ${String(error)}`);
		}
	}

	return {
		summary(query: StatsQuery): Promise<StatsSummaryResult> {
			lastViewedAt = Date.now();
			const key = `${query.range}|${query.harness ?? ""}|${query.timeZone ?? ""}|${query.refresh ? "1" : "0"}`;
			const existing = inflightSummaries.get(key);
			if (existing) return existing;
			const task = (async (): Promise<StatsSummaryResult> => {
				try {
					await ensureWorker();
					const res = await send({ op: "summary", query });
					if (!res.ok || !res.summary) {
						return {
							status: "rejected",
							rejection: { code: "backend_error", message: res.ok ? "no summary returned" : res.error },
						};
					}
					return res.summary;
				} catch (error) {
					return {
						status: "rejected",
						rejection: { code: "backend_error", message: error instanceof Error ? error.message : String(error) },
					};
				} finally {
					inflightSummaries.delete(key);
				}
			})();
			inflightSummaries.set(key, task);
			return task;
		},

		start(): () => void {
			// Kick off an initial quiet scan shortly after startup without delaying bridge boot.
			const boot = setTimeout(() => {
				void triggerScan(false).finally(() => schedulePeriodic());
			}, 3_000);
			boot.unref?.();
			return () => {
				clearTimeout(boot);
				if (periodicTimer) clearTimeout(periodicTimer);
				if (debounceTimer) clearTimeout(debounceTimer);
				periodicTimer = undefined;
				debounceTimer = undefined;
			};
		},

		notifyActivity(): void {
			if (disposed) return;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				debounceTimer = undefined;
				void triggerScan(false);
			}, POST_ACTIVITY_DEBOUNCE_MS);
			debounceTimer.unref?.();
		},

		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			if (periodicTimer) clearTimeout(periodicTimer);
			if (debounceTimer) clearTimeout(debounceTimer);
			for (const slot of pending.values()) slot.resolve({ id: 0, ok: false, error: "disposed" });
			pending.clear();
			if (worker) {
				try {
					worker.postMessage({ id: nextId++, op: "dispose" } satisfies WorkerRequest);
				} catch {
					// Ignore if already terminated.
				}
				worker.terminate();
				worker = undefined;
			}
		},
	};
}
