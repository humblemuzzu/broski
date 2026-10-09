import type { Context } from "@earendil-works/chord";
import type { Models } from "@earendil-works/pi-ai";
import type {
	AgentChange,
	Conversation,
	Extension,
	HarnessInspection,
	HarnessSettings,
} from "@earendil-works/pi-durable";
import { Harness } from "@earendil-works/pi-durable";
import type { JsonlStorage } from "@earendil-works/pi-durable/storage/jsonl";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { createPiDurableAgentSetup, piDurableExecutionEnv } from "./agent-setup";
import { acquirePiDurableStorageLock, type PiDurableStorageLock } from "./storage-lock";

export type PiDurableSessionRuntime = {
	readonly sessionId: string;
	readonly harness: Harness;
	readonly conversation: Conversation;
	readonly storage: JsonlStorage;
	readonly lock: PiDurableStorageLock;
};

export type PiDurableSessionOpenOptions = {
	sessionId: string;
	directory: string;
	cwd: string;
	models: Models;
	agent: AgentChange;
	extensions?: readonly Extension[];
	settings?: HarnessSettings;
	context: Context;
};

export async function openPiDurableSessionRuntime(
	options: PiDurableSessionOpenOptions,
): Promise<PiDurableSessionRuntime> {
	const lock = acquirePiDurableStorageLock(options.directory);
	let storage: JsonlStorage | undefined;
	try {
		storage = await openNodeJsonlStorage(options.directory, options.context, { fsync: true });
		const setup = createPiDurableAgentSetup({ cwd: options.cwd, extensions: options.extensions });
		const harness = await Harness.open(
			storage,
			{
				models: options.models,
				registry: setup.registry,
				env: piDurableExecutionEnv(options.cwd),
				...(options.settings !== undefined ? { settings: options.settings } : {}),
			},
			options.context,
		);
		const conversation = await harness.root(options.context, { agent: options.agent });
		return { sessionId: options.sessionId, harness, conversation, storage, lock };
	} catch (error) {
		if (storage !== undefined) await storage.close(options.context).catch(() => undefined);
		lock.release();
		throw error;
	}
}

export async function closePiDurableSessionRuntime(runtime: PiDurableSessionRuntime, context: Context): Promise<void> {
	await runtime.harness.close(context).catch(() => undefined);
	await runtime.storage.close(context).catch(() => undefined);
	runtime.lock.release();
}

export function inspectPiDurableSession(
	runtime: PiDurableSessionRuntime,
	context: Context,
): Promise<HarnessInspection> {
	return runtime.harness.inspect(context);
}
