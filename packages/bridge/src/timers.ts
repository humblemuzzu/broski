export type ManagedInterval = {
	/** Starts a repeating callback; the returned function stops it. */
	start: (fn: () => void, ms: number) => () => void;
};

export const nodeInterval: ManagedInterval = {
	start: (fn: () => void, ms: number) => {
		const handle = setInterval(fn, ms);
		return () => clearInterval(handle);
	},
};
