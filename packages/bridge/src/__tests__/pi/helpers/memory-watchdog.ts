/**
 * A thread that ends the test process, with a message, when it grows past a memory limit or its event loop
 * stops turning (AGENTS.md, Test Hygiene). A wrong adapter that loops on promises starves every timer
 * of the main thread, so the check has to live on another one: measured with an endless re-prompt, the
 * process took 1 GB every 3 s and no timer on it ever ran.
 */

export interface WatchdogLimits {
	readonly maxRssMb: number;
	/** How long the main thread may go without turning its event loop. */
	readonly stallMs: number;
}

export interface Watchdog {
	disarm(): void;
}

const DEFAULT_LIMITS: WatchdogLimits = { maxRssMb: 3_072, stallMs: 10_000 };
const BEAT_EVERY_MS = 100;

export function armWatchdog(limits: WatchdogLimits = DEFAULT_LIMITS): Watchdog {
	const heartbeat = new SharedArrayBuffer(8);
	const beat = new BigInt64Array(heartbeat);
	const touch = () => Atomics.store(beat, 0, BigInt(Date.now()));
	touch();
	const beating = setInterval(touch, BEAT_EVERY_MS);
	beating.unref();
	const watcher = new Worker(new URL("./watchdog-worker.ts", import.meta.url).href);
	watcher.postMessage({ heartbeat, pid: process.pid, ...limits });
	return {
		disarm: () => {
			clearInterval(beating);
			watcher.terminate();
		},
	};
}
