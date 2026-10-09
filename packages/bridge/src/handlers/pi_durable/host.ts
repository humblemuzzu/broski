import { ensurePiModelRuntime } from "../../connectors/pi/pi-model-runtime";
import {
	listPiDurableModels,
	PiDurableHarnessHost,
	type PiDurableModelChoice,
	PiDurablePermissions,
	resolvePiDurableModel,
	sharedPiDurableModelAccess,
} from "../../connectors/pi-durable";
import { broadcastPiDurablePermission } from "./transport";

export type PiDurableDeps = {
	host(): Promise<PiDurableHarnessHost>;
	listModels(): Promise<PiDurableModelChoice[]>;
	resolveModel(provider: string, modelId: string): Promise<PiDurableModelChoice | undefined>;
};

let host: PiDurableHarnessHost | undefined;
let creating: Promise<PiDurableHarnessHost> | undefined;

async function createPiDurableHost(): Promise<PiDurableHarnessHost> {
	try {
		const access = await sharedPiDurableModelAccess();
		host = new PiDurableHarnessHost({
			models: access.models,
			isSubscription: access.isSubscription,
			permissions: new PiDurablePermissions({ onRequest: (request) => broadcastPiDurablePermission(request) }),
		});
		return host;
	} catch (error) {
		creating = undefined;
		throw error;
	}
}

/** The one harness host of this bridge process, created on first use. */
export function piDurableHost(): Promise<PiDurableHarnessHost> {
	if (host !== undefined) return Promise.resolve(host);
	creating ??= createPiDurableHost();
	return creating;
}

export const piDurableDeps: PiDurableDeps = {
	host: piDurableHost,
	listModels: listPiDurableModels,
	resolveModel: resolvePiDurableModel,
};

export async function piDurableAvailability(): Promise<{ available: boolean; authenticated: boolean }> {
	try {
		const runtime = await ensurePiModelRuntime();
		const authenticated = runtime.getAvailableSnapshot().length > 0;
		return { available: authenticated, authenticated };
	} catch {
		return { available: false, authenticated: false };
	}
}

export async function closePiDurableHost(): Promise<void> {
	const pending = creating;
	if (pending === undefined) return;
	const created = await pending.catch(() => undefined);
	if (creating === pending) creating = undefined;
	if (created === undefined) return;
	if (host === created) host = undefined;
	await created.closeAll();
}
