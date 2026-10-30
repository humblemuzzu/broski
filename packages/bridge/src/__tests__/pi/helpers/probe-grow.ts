/**
 * Run by `probe.test.ts`: arms the watchdog with a small memory limit, then grows through promises past it and
 * keeps the chain going without growing further, so only the watchdog thread can end it, and the process's peak is
 * the plateau whenever that thread looks: growth at memory speed between two looks once reached gigabytes.
 */

import { armWatchdog } from "./memory-watchdog";

const LIMIT_MB = 500;
const PLATEAU_MB = 700;

armWatchdog({ maxRssMb: LIMIT_MB, stallMs: 600_000 });
const keep: number[][] = [];
const grow = (): void => {
	if (process.memoryUsage().rss / 1024 ** 2 < PLATEAU_MB) keep.push(new Array(200_000).fill(1));
	void Promise.resolve().then(grow);
};
grow();
