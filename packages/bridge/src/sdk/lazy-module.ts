export type LazyModule<T> = {
	load: () => Promise<T>;
	/** The module value. Only valid once `load()` has resolved. */
	get: () => T;
};

export function createLazyModule<T>(name: string, loader: () => Promise<T>): LazyModule<T> {
	let value: T | null = null;
	let pending: Promise<T> | null = null;
	return {
		load: () => {
			if (value !== null) return Promise.resolve(value);
			pending ??= loader().then((module) => {
				value = module;
				return module;
			});
			return pending;
		},
		get: () => {
			if (value === null) throw new Error(`${name} used before its lazy import resolved`);
			return value;
		},
	};
}
