export type TeardownTask = {
	name: string;
	run: () => unknown;
};

export type TeardownFailure = {
	name: string;
	error: unknown;
};

export type TeardownResult = {
	timedOut: boolean;
	completed: string[];
	failed: TeardownFailure[];
	pending: string[];
};

export type TeardownOptions = {
	/** Overall budget for all tasks. After it elapses the caller proceeds without the stragglers. */
	timeoutMs?: number;
	onError?: (name: string, error: unknown) => void;
	onTimeout?: (pending: string[]) => void;
};

export const DEFAULT_TEARDOWN_TIMEOUT_MS = 5000;

export async function runTeardown(tasks: TeardownTask[], options?: TeardownOptions): Promise<TeardownResult> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TEARDOWN_TIMEOUT_MS;
	const done = new Set<string>();
	const failed: TeardownFailure[] = [];

	const runs = tasks.map(async (task) => {
		try {
			await task.run();
		} catch (error) {
			failed.push({ name: task.name, error });
			options?.onError?.(task.name, error);
		} finally {
			done.add(task.name);
		}
	});

	const settle = (): TeardownResult => {
		const pending = tasks.map((task) => task.name).filter((name) => !done.has(name));
		if (pending.length > 0) options?.onTimeout?.(pending);
		return {
			timedOut: pending.length > 0,
			completed: tasks
				.map((task) => task.name)
				.filter((name) => done.has(name) && !failed.some((f) => f.name === name)),
			failed,
			pending,
		};
	};

	if (timeoutMs <= 0) {
		await Promise.race([Promise.all(runs), Promise.resolve()]);
		return settle();
	}

	let expire: (() => void) | null = null;
	const expired = new Promise<void>((resolve) => {
		expire = resolve;
	});
	const timer = setTimeout(() => expire?.(), timeoutMs);

	await Promise.race([Promise.all(runs), expired]);
	clearTimeout(timer);

	return settle();
}
