import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	createAgentSession,
	type ExtensionCommandContextActions,
	type SessionBeforeSwitchEvent,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { bindExtensionsOnSession, makeEmitter, makeExtensionUiBridge } from "./pi-extension-binding";
import type { PiInstance, PiSessionRebuildEvent } from "./pi-instance-types";
import { ensurePiModelRuntime } from "./pi-model-runtime";

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

async function emitSessionBeforeSwitch(instance: PiInstance, event: SessionBeforeSwitchEvent): Promise<boolean> {
	const runner = instance.session.extensionRunner;
	if (!runner.hasHandlers("session_before_switch")) return false;

	const result = await runner.emit(event);
	return result?.cancel === true;
}

async function emitSessionBeforeFork(instance: PiInstance, entryId: string): Promise<boolean> {
	const runner = instance.session.extensionRunner;
	if (!runner.hasHandlers("session_before_fork")) return false;

	const result = await runner.emit({ type: "session_before_fork", entryId, position: "before" });
	return result?.cancel === true;
}

export function buildCommandContextActions(instance: PiInstance): ExtensionCommandContextActions {
	return {
		waitForIdle: () => instance.session.agent.waitForIdle(),
		newSession: async (setupOptions?: { parentSession?: string; setup?: (sm: SessionManager) => Promise<void> }) => {
			return createNewSession(instance, setupOptions);
		},
		fork: async (entryId: string) => {
			return forkSession(instance, entryId);
		},
		navigateTree: async (
			targetId: string,
			navOptions?: {
				summarize?: boolean;
				customInstructions?: string;
				replaceInstructions?: boolean;
				label?: string;
			},
		) => {
			const result = await instance.session.navigateTree(targetId, {
				summarize: navOptions?.summarize,
				customInstructions: navOptions?.customInstructions,
				replaceInstructions: navOptions?.replaceInstructions,
				label: navOptions?.label,
			});
			return { cancelled: result.cancelled };
		},
		switchSession: async (sessionPath: string) => {
			return switchToSession(instance, sessionPath);
		},
		reload: async () => {
			await instance.session.reload();
		},
	};
}

/**
 * Core rebuild: tears down the current session and creates a new one.
 *
 * After this call, instance.session is the NEW session. The old session is disposed.
 * All listeners stay attached (they reference instance.listeners which is stable).
 */
async function rebuildInstanceSession(
	instance: PiInstance,
	sessionManager: SessionManager,
	sessionStartEvent: PiSessionRebuildEvent,
): Promise<void> {
	try {
		await instance.session.extensionRunner.emit({ type: "session_shutdown", reason: sessionStartEvent.reason });
	} catch {
		// Shutdown event failure should not block rebuild.
	}

	instance.unsubscribe();
	instance.extensionUiBridge.dispose();
	instance.session.dispose();

	await instance.resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd: instance.cwd,
		modelRuntime: await ensurePiModelRuntime(),
		sessionManager,
		settingsManager: instance.settingsManager,
		resourceLoader: instance.resourceLoader,
		sessionStartEvent,
	});

	instance.session = session;
	instance.extensionUiBridge = makeExtensionUiBridge(instance);
	const emitToListeners = makeEmitter(instance);
	instance.unsubscribe = session.subscribe((event) => {
		emitToListeners(event);
	});

	await bindExtensionsOnSession(instance, session, buildCommandContextActions(instance));
}

/**
 * Create a new empty session for a Pi instance.
 * Mirrors AgentSessionRuntime.newSession().
 */
export async function createNewSession(
	instance: PiInstance,
	setupOptions?: { parentSession?: string; setup?: (sm: SessionManager) => Promise<void> },
): Promise<{ cancelled: boolean }> {
	if (await emitSessionBeforeSwitch(instance, { type: "session_before_switch", reason: "new" })) {
		return { cancelled: true };
	}

	const previousSessionFile = instance.session.sessionFile ?? undefined;
	const sessionDir = instance.session.sessionManager.getSessionDir();
	const newManager = SessionManager.create(instance.cwd, sessionDir);
	if (setupOptions?.parentSession) {
		newManager.newSession({ parentSession: setupOptions.parentSession });
	}

	await rebuildInstanceSession(instance, newManager, {
		type: "session_start",
		reason: "new",
		previousSessionFile,
	});

	if (setupOptions?.setup) {
		await setupOptions.setup(instance.session.sessionManager);
		instance.session.refreshContext();
	}

	return { cancelled: false };
}

/**
 * Switch to an existing session.
 * Mirrors AgentSessionRuntime.switchSession().
 */
export async function switchToSession(instance: PiInstance, sessionPath: string): Promise<{ cancelled: boolean }> {
	const cancelled = await emitSessionBeforeSwitch(instance, {
		type: "session_before_switch",
		reason: "resume",
		targetSessionFile: sessionPath,
	});
	if (cancelled) return { cancelled: true };

	const previousSessionFile = instance.session.sessionFile ?? undefined;
	const sm = SessionManager.open(sessionPath);

	await rebuildInstanceSession(instance, sm, {
		type: "session_start",
		reason: "resume",
		previousSessionFile,
	});

	return { cancelled: false };
}

/**
 * Fork from a specific user message entry.
 * Mirrors AgentSessionRuntime.fork().
 */
export async function forkSession(
	instance: PiInstance,
	entryId: string,
): Promise<{ cancelled: boolean; selectedText?: string }> {
	if (await emitSessionBeforeFork(instance, entryId)) return { cancelled: true };

	const sm = instance.session.sessionManager;
	const selectedEntry = sm.getEntry(entryId);
	if (!selectedEntry || selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
		throw new Error("Invalid entry ID for forking");
	}

	const previousSessionFile = instance.session.sessionFile ?? undefined;
	const selectedText = extractUserMessageText(selectedEntry.message.content);
	const sessionDir = sm.getSessionDir();

	if (sm.isPersisted()) {
		await rebuildPersistedFork(instance, selectedEntry.parentId, sessionDir, previousSessionFile);
		return { cancelled: false, selectedText };
	}

	await rebuildInPlaceFork(instance, sm, selectedEntry.parentId, previousSessionFile);
	return { cancelled: false, selectedText };
}

async function rebuildPersistedFork(
	instance: PiInstance,
	parentId: string | null,
	sessionDir: string,
	previousSessionFile: string | undefined,
): Promise<void> {
	const currentSessionFile = instance.session.sessionFile;
	if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

	if (!parentId) {
		const newManager = SessionManager.create(instance.cwd, sessionDir);
		newManager.newSession({ parentSession: currentSessionFile });
		await rebuildInstanceSession(instance, newManager, {
			type: "session_start",
			reason: "fork",
			previousSessionFile,
		});
		return;
	}

	const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
	const forkedPath = sourceManager.createBranchedSession(parentId);
	if (!forkedPath) throw new Error("Failed to create forked session");

	const forkedManager = SessionManager.open(forkedPath, sessionDir);
	await rebuildInstanceSession(instance, forkedManager, {
		type: "session_start",
		reason: "fork",
		previousSessionFile,
	});
}

async function rebuildInPlaceFork(
	instance: PiInstance,
	sm: SessionManager,
	parentId: string | null,
	previousSessionFile: string | undefined,
): Promise<void> {
	if (!parentId) {
		sm.newSession({ parentSession: instance.session.sessionFile });
	} else {
		const branchedPath = sm.createBranchedSession(parentId);
		if (!branchedPath) throw new Error("Failed to create forked session (non-persisted branch)");
	}

	await rebuildInstanceSession(instance, sm, {
		type: "session_start",
		reason: "fork",
		previousSessionFile,
	});
}

/**
 * Import a JSONL session file.
 * Mirrors AgentSessionRuntime.importFromJsonl().
 */
export async function importFromJsonl(instance: PiInstance, inputPath: string): Promise<{ cancelled: boolean }> {
	const resolvedPath = resolve(inputPath);
	if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);

	const sessionDir = instance.session.sessionManager.getSessionDir();
	if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

	const destinationPath = join(sessionDir, basename(resolvedPath));

	const cancelled = await emitSessionBeforeSwitch(instance, {
		type: "session_before_switch",
		reason: "resume",
		targetSessionFile: destinationPath,
	});
	if (cancelled) return { cancelled: true };

	const previousSessionFile = instance.session.sessionFile ?? undefined;
	if (resolve(destinationPath) !== resolvedPath) {
		copyFileSync(resolvedPath, destinationPath);
	}

	const sm = SessionManager.open(destinationPath, sessionDir);
	await rebuildInstanceSession(instance, sm, {
		type: "session_start",
		reason: "resume",
		previousSessionFile,
	});

	return { cancelled: false };
}
