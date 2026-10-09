import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PiExtensionUiResponseInput } from "../pi_extension_ui";
import { normalizeCwd } from "./pi-cwd";
import { bindExtensionsOnSession, createExtensionUiBridge, makeEmitter } from "./pi-extension-binding";
import type { GetOrCreatePiOptions, PiActiveRuntimeState, PiEventListener, PiInstance } from "./pi-instance-types";
import { ensurePiModelRuntime, findModel } from "./pi-model-runtime";
import { buildCommandContextActions, switchToSession } from "./pi-session-lifecycle";
import { mapStatePayload } from "./pi-session-state";

const instances = new Map<string, PiInstance>();

async function buildInstance(cwd: string, options?: GetOrCreatePiOptions): Promise<PiInstance> {
	const settingsManager = SettingsManager.create(cwd);
	const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), settingsManager });
	await resourceLoader.reload();

	const sessionManager = options?.sessionPath
		? SessionManager.open(options.sessionPath)
		: SessionManager.continueRecent(cwd);

	const modelRuntime = await ensurePiModelRuntime();
	const model =
		options?.provider && options.modelId ? modelRuntime.getModel(options.provider, options.modelId) : undefined;

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: options?.thinkingLevel,
		modelRuntime,
		sessionManager,
		settingsManager,
		resourceLoader,
	});

	const listeners = new Set<PiEventListener>();
	let emitToListeners: PiEventListener = () => {};

	const instance: PiInstance = {
		session,
		resourceLoader,
		settingsManager,
		listeners,
		extensionUiBridge: createExtensionUiBridge((event) => emitToListeners(event)),
		unsubscribe: () => {},
		cwd,
		createdAt: Date.now(),
		lastActivityAt: Date.now(),
	};

	emitToListeners = makeEmitter(instance);
	instance.unsubscribe = session.subscribe((event) => {
		emitToListeners(event);
	});

	await bindExtensionsOnSession(instance, session, buildCommandContextActions(instance));

	return instance;
}

export async function getOrCreateInstance(cwd?: string, options?: GetOrCreatePiOptions): Promise<PiInstance> {
	const normalizedCwd = normalizeCwd(cwd);
	const existing = instances.get(normalizedCwd);

	if (existing) {
		existing.lastActivityAt = Date.now();

		if (options?.sessionPath && existing.session.sessionFile !== options.sessionPath) {
			await switchToSession(existing, options.sessionPath);
		}

		if (options?.provider && options.modelId) {
			const model = await findModel(options.provider, options.modelId);
			if (model) {
				await existing.session.setModel(model);
			}
		}

		if (options?.thinkingLevel) {
			existing.session.setThinkingLevel(options.thinkingLevel);
		}

		return existing;
	}

	const instance = await buildInstance(normalizedCwd, options);
	instances.set(normalizedCwd, instance);
	return instance;
}

export async function addEventListener(cwd: string, listener: PiEventListener): Promise<() => void> {
	const instance = await getOrCreateInstance(cwd);
	instance.listeners.add(listener);
	return () => {
		instance.listeners.delete(listener);
	};
}

/** Non-creating getter — returns undefined if no instance exists for this cwd. */
export function getInstance(cwd?: string): PiInstance | undefined {
	return instances.get(normalizeCwd(cwd));
}

export function listInstances(): PiInstance[] {
	return Array.from(instances.values());
}

export function disposeInstance(cwd?: string): void {
	const normalizedCwd = normalizeCwd(cwd);
	const instance = instances.get(normalizedCwd);
	if (!instance) return;

	instance.listeners.clear();
	instance.extensionUiBridge.dispose();
	instance.unsubscribe();
	instance.session.dispose();
	instances.delete(normalizedCwd);
}

export function disposeAll(): void {
	for (const cwd of instances.keys()) {
		disposeInstance(cwd);
	}
}

/**
 * Dispose instances that have been idle (no events, no API access) for
 * longer than `maxIdleMs`.  Only prunes instances with zero listeners
 * and whose agent is not actively streaming.
 */
export function pruneIdleInstances(maxIdleMs = 30 * 60_000): number {
	const now = Date.now();
	let pruned = 0;
	for (const [cwd, instance] of instances) {
		if (instance.listeners.size > 0) continue;
		if (instance.session.agent.state.isStreaming) continue;
		if (now - instance.lastActivityAt < maxIdleMs) continue;
		disposeInstance(cwd);
		pruned++;
	}
	return pruned;
}

export function respondToExtensionUi(cwd: string, response: PiExtensionUiResponseInput): boolean {
	const instance = instances.get(normalizeCwd(cwd));
	if (!instance) return false;

	return instance.extensionUiBridge.resolveResponse(response);
}

export function listActiveRuntimeStates(): PiActiveRuntimeState[] {
	return listInstances().map((instance) => ({
		cwd: instance.cwd,
		state: mapStatePayload(instance),
	}));
}
