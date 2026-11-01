/** Time as the adapter reads it, so tests drive idle graces (D1) and cache ages (D6) without waiting. */
export interface Clock {
	now(): number;
	/** Runs `run` once after `ms`; the function returned cancels it. Never keeps the process alive. */
	after(ms: number, run: () => void): () => void;
}

export const SYSTEM_CLOCK: Clock = {
	now: () => Date.now(),
	after: (ms, run) => {
		const timer = setTimeout(run, ms);
		timer.unref?.();
		return () => clearTimeout(timer);
	},
};
