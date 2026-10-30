/** The other thread of `armWatchdog`: it reads the main thread's heartbeat and the process's memory, and kills on a breach. */

import type { WatchdogLimits } from "./memory-watchdog";

interface Start extends WatchdogLimits {
	readonly heartbeat: SharedArrayBuffer;
	readonly pid: number;
}

const CHECK_EVERY_MS = 200;

self.addEventListener("message", (event: MessageEvent<Start>) => {
	const { heartbeat, pid, maxRssMb, stallMs } = event.data;
	const beat = new BigInt64Array(heartbeat);
	setInterval(() => {
		const rssMb = Math.round(process.memoryUsage().rss / 1024 ** 2);
		const silentMs = Date.now() - Number(Atomics.load(beat, 0));
		const why =
			rssMb > maxRssMb
				? `the test process holds ${rssMb} MB, past ${maxRssMb} MB`
				: silentMs > stallMs
					? `the test process has not turned its event loop for ${silentMs} ms`
					: undefined;
		if (why === undefined) return;
		process.stderr.write(`\nwatchdog: ${why}: a loop in the adapter or in a test. Killing it.\n`);
		process.kill(pid, "SIGKILL");
	}, CHECK_EVERY_MS);
});
