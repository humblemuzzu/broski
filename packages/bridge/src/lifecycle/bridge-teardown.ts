import { runTeardown, type TeardownResult } from "./teardown";

export type BridgeTeardownResources = {
	/** Called synchronously first so no new work is accepted while cleanup runs. */
	stopServers: () => void;
	/** The bridge core and every backend it serves. */
	disposeBackends: () => unknown;
};

export type BridgeTeardownOptions = {
	timeoutMs?: number;
	log?: (message: string) => void;
};

export async function stopBridgeResources(
	resources: BridgeTeardownResources,
	options?: BridgeTeardownOptions,
): Promise<TeardownResult> {
	try {
		resources.stopServers();
	} catch {
		// Server is already down or refused to stop.
	}

	return await runTeardown([{ name: "backends", run: resources.disposeBackends }], {
		timeoutMs: options?.timeoutMs,
		onError: (name, error) => options?.log?.(`[shutdown] ${name} cleanup failed: ${describeError(error)}`),
		onTimeout: (pending) => options?.log?.(`[shutdown] cleanup timed out; still pending: ${pending.join(", ")}`),
	});
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
