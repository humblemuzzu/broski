/**
 * AGENTS.md test hygiene: a script that reads real-sized data runs under a watchdog. It samples the whole process's RSS
 * (worker threads included) and ends the process when a limit is crossed, instead of letting the machine swap.
 */

export interface Watchdog {
	/** The highest RSS sampled so far, in bytes. */
	peak(): number;
	stop(): void;
}

export function startWatchdog(limitBytes: number, label: string, everyMs = 20): Watchdog {
	let highest = process.memoryUsage().rss;
	const timer = setInterval(() => {
		const rss = process.memoryUsage().rss;
		if (rss > highest) highest = rss;
		if (rss > limitBytes) {
			console.error(
				`memory watchdog: ${label} reached ${Math.round(rss / 1_048_576)} MiB (limit ${Math.round(limitBytes / 1_048_576)} MiB); ending the process`,
			);
			process.exit(86);
		}
	}, everyMs);
	return {
		peak: () => Math.max(highest, process.memoryUsage().rss),
		stop: () => clearInterval(timer),
	};
}

export const mib = (bytes: number): number => Math.round(bytes / 1_048_576);
