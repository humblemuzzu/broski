import { runTeardown, type TeardownResult, type TeardownTask } from "./teardown";

export type StoppableResource = {
	stop: () => unknown;
};

export type BridgeTeardownResources = {
	/** Session -> tailer maps for every backend that runs external tails. */
	externalTails: Array<Map<string, StoppableResource>>;
	eventBuffers: Array<Map<string, unknown>>;
	closeFsWatchers: () => void;
	stopPtyRuntime: () => unknown;
	uninstallHooks: Array<() => unknown>;
	stopCodexAppServer: () => unknown;
	disposeBackends: Array<() => unknown>;
	/** Called synchronously first so no new work is accepted while cleanup runs. */
	stopServers: () => void;
};

export type BridgeTeardownOptions = {
	timeoutMs?: number;
	log?: (message: string) => void;
};

export function buildTeardownTasks(resources: BridgeTeardownResources): TeardownTask[] {
	const stopTails = () => {
		for (const tails of resources.externalTails) {
			for (const tail of tails.values()) {
				try {
					tail.stop();
				} catch {
					// A failed tail must not block the rest of the teardown.
				}
			}
			tails.clear();
		}
	};

	const clearBuffers = () => {
		for (const buffer of resources.eventBuffers) {
			buffer.clear();
		}
	};

	const disposeBackends = async () => {
		await Promise.all(resources.disposeBackends.map((dispose) => dispose()));
	};

	return [
		{ name: "external-tails", run: stopTails },
		{ name: "event-buffers", run: clearBuffers },
		{ name: "fs-watchers", run: resources.closeFsWatchers },
		{ name: "pty-runtime", run: resources.stopPtyRuntime },
		...resources.uninstallHooks.map((run, index) => ({ name: `hook-uninstall-${index + 1}`, run })),
		{ name: "codex-app-server", run: resources.stopCodexAppServer },
		{ name: "backends", run: disposeBackends },
	];
}

export type FailedBindResources = {
	intervals: Array<ReturnType<typeof setInterval> | null>;
	stopEndpointWatcher?: () => void;
};

/** Cancels the timers a server instance started before its port bind failed, so a retry does not stack them. */
export function releaseFailedBindResources(resources: FailedBindResources): void {
	for (const interval of resources.intervals) {
		if (interval) clearInterval(interval);
	}
	resources.stopEndpointWatcher?.();
}

export async function stopBridgeResources(
	resources: BridgeTeardownResources,
	options?: BridgeTeardownOptions,
): Promise<TeardownResult> {
	try {
		resources.stopServers();
	} catch {
		// Server is already down or refused to stop.
	}

	return await runTeardown(buildTeardownTasks(resources), {
		timeoutMs: options?.timeoutMs,
		onError: (name, error) => options?.log?.(`[shutdown] ${name} cleanup failed: ${describeError(error)}`),
		onTimeout: (pending) => options?.log?.(`[shutdown] cleanup timed out; still pending: ${pending.join(", ")}`),
	});
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
