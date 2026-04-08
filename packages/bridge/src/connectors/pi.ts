import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	type SessionInfo,
	type SessionStartEvent,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@mariozechner/pi-coding-agent";
import type {
	PiCommandPayload,
	PiForkMessagePayload,
	PiModelPayload,
	PiSessionInfo,
	PiStatePayload,
	ProjectSummary,
} from "../types";
import type { PiBridgeSyntheticEvent } from "./pi/pi-events";
import { computePiSessionStats } from "./pi/pi-session-stats";
import {
	createPiExtensionUiBridge,
	type PiExtensionUiBridge,
	type PiExtensionUiResponseInput,
} from "./pi_extension_ui";

type PiEventListener = (event: AgentSessionEvent | PiBridgeSyntheticEvent) => void;

export type GetOrCreatePiOptions = {
	provider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	sessionPath?: string;
};

export type PiAvailability = {
	available: boolean;
	authenticated: boolean;
	modelCount: number;
	version?: string;
};

export type PiInstance = {
	session: AgentSession;
	resourceLoader: DefaultResourceLoader;
	settingsManager: SettingsManager;
	listeners: Set<PiEventListener>;
	extensionUiBridge: PiExtensionUiBridge;
	unsubscribe: () => void;
	cwd: string;
	createdAt: number;
	lastActivityAt: number;
};

export type PiActiveRuntimeState = {
	cwd: string;
	state: PiStatePayload;
};

let authStorage: AuthStorage | null = null;
let modelRegistry: ModelRegistry | null = null;

const instances = new Map<string, PiInstance>();

const normalizeCwd = (cwd?: string): string => {
	const value = (cwd ?? "").trim();
	return resolve(value || process.cwd());
};

const getSessionsRoot = (): string => resolve(getAgentDir(), "sessions");

export function getAuthStorage(): AuthStorage {
	if (!authStorage) {
		authStorage = AuthStorage.create();
	}
	return authStorage;
}

export function getModelRegistry(): ModelRegistry {
	if (!modelRegistry) {
		modelRegistry = ModelRegistry.create(getAuthStorage());
	}
	return modelRegistry!;
}

const drainAuthStorageErrors = (): void => {
	const errors = getAuthStorage().drainErrors();
	for (const error of errors) {
		console.warn(`[pi-auth-storage] ${error.message}`);
	}
};

// ── Session lifecycle helpers ────────────────────────────────────────────────

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

function makeEmitter(instance: PiInstance) {
	return (event: AgentSessionEvent | PiBridgeSyntheticEvent) => {
		instance.lastActivityAt = Date.now();
		for (const listener of instance.listeners) {
			try {
				listener(event);
			} catch {
				// Listener errors should never crash the bridge.
			}
		}
	};
}

function makeExtensionUiBridge(instance: PiInstance) {
	const emitToListeners = makeEmitter(instance);
	return createPiExtensionUiBridge((streamMessage) => {
		emitToListeners({ type: "__pi_bridge_stream__", streamMessage });
	});
}

function buildCommandContextActions(instance: PiInstance) {
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

async function bindExtensionsOnSession(instance: PiInstance, session: AgentSession): Promise<void> {
	await session.bindExtensions({
		uiContext: instance.extensionUiBridge.uiContext,
		commandContextActions: buildCommandContextActions(instance),
		onError: (error) => {
			instance.extensionUiBridge.uiContext.notify(`[${error.extensionPath}] ${error.error}`, "error");
		},
	});
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
	sessionStartEvent?: SessionStartEvent,
): Promise<void> {
	// 1. Emit shutdown to old extensions (best-effort)
	try {
		const runner = instance.session.extensionRunner;
		if (runner) {
			await runner.emit({ type: "session_shutdown" as const });
		}
	} catch {
		// Shutdown event failure should not block rebuild.
	}

	// 2. Tear down old session
	instance.unsubscribe();
	instance.extensionUiBridge.dispose();
	instance.session.dispose();

	// 3. Reload resources for consistency
	await instance.resourceLoader.reload();

	// 4. Create new session
	const { session } = await createAgentSession({
		cwd: instance.cwd,
		authStorage: getAuthStorage(),
		modelRegistry: getModelRegistry(),
		sessionManager,
		settingsManager: instance.settingsManager,
		resourceLoader: instance.resourceLoader,
		sessionStartEvent,
	});

	// 5. Swap references
	instance.session = session;
	instance.extensionUiBridge = makeExtensionUiBridge(instance);
	const emitToListeners = makeEmitter(instance);
	instance.unsubscribe = session.subscribe((event) => {
		emitToListeners(event);
	});

	// 6. Bind extensions on new session
	await bindExtensionsOnSession(instance, session);
}

// ── Public session lifecycle functions ───────────────────────────────────────

/**
 * Create a new empty session for a Pi instance.
 * Mirrors AgentSessionRuntime.newSession().
 */
export async function createNewSession(
	instance: PiInstance,
	setupOptions?: { parentSession?: string; setup?: (sm: SessionManager) => Promise<void> },
): Promise<{ cancelled: boolean }> {
	// Emit before_switch for extension cancellation
	const runner = instance.session.extensionRunner;
	if (runner?.hasHandlers("session_before_switch")) {
		const result = await runner.emit({ type: "session_before_switch", reason: "new" } as any);
		if ((result as any)?.cancel === true) return { cancelled: true };
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
		instance.session.agent.state.messages = instance.session.sessionManager.buildSessionContext().messages;
	}

	return { cancelled: false };
}

/**
 * Switch to an existing session.
 * Mirrors AgentSessionRuntime.switchSession().
 */
export async function switchToSession(
	instance: PiInstance,
	sessionPath: string,
): Promise<{ cancelled: boolean }> {
	const runner = instance.session.extensionRunner;
	if (runner?.hasHandlers("session_before_switch")) {
		const result = await runner.emit({
			type: "session_before_switch",
			reason: "resume",
			targetSessionFile: sessionPath,
		} as any);
		if ((result as any)?.cancel === true) return { cancelled: true };
	}

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
	// Emit before_fork for extension cancellation
	const runner = instance.session.extensionRunner;
	if (runner?.hasHandlers("session_before_fork")) {
		const result = await runner.emit({ type: "session_before_fork", entryId } as any);
		if ((result as any)?.cancel === true) return { cancelled: true };
	}

	const sm = instance.session.sessionManager;
	const selectedEntry = sm.getEntry(entryId) as any;
	if (!selectedEntry || selectedEntry.type !== "message" || selectedEntry.message?.role !== "user") {
		throw new Error("Invalid entry ID for forking");
	}

	const previousSessionFile = instance.session.sessionFile ?? undefined;
	const selectedText = extractUserMessageText(selectedEntry.message.content);
	const sessionDir = sm.getSessionDir();

	if (sm.isPersisted()) {
		const currentSessionFile = instance.session.sessionFile;
		if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

		if (!selectedEntry.parentId) {
			// Fork from root — create new session with parent link
			const newManager = SessionManager.create(instance.cwd, sessionDir);
			newManager.newSession({ parentSession: currentSessionFile });
			await rebuildInstanceSession(instance, newManager, {
				type: "session_start",
				reason: "fork",
				previousSessionFile,
			});
			return { cancelled: false, selectedText };
		}

		// Fork from mid-conversation — create branched session file
		const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
		const forkedPath = sourceManager.createBranchedSession(selectedEntry.parentId);
		if (!forkedPath) throw new Error("Failed to create forked session");

		const forkedManager = SessionManager.open(forkedPath, sessionDir);
		await rebuildInstanceSession(instance, forkedManager, {
			type: "session_start",
			reason: "fork",
			previousSessionFile,
		});
		return { cancelled: false, selectedText };
	}

	// Non-persisted session — branch in place
	if (!selectedEntry.parentId) {
		sm.newSession({ parentSession: instance.session.sessionFile });
	} else {
		const branchedPath = sm.createBranchedSession(selectedEntry.parentId);
		if (!branchedPath) throw new Error("Failed to create forked session (non-persisted branch)");
	}
	await rebuildInstanceSession(instance, sm, {
		type: "session_start",
		reason: "fork",
		previousSessionFile,
	});
	return { cancelled: false, selectedText };
}

/**
 * Import a JSONL session file.
 * Mirrors AgentSessionRuntime.importFromJsonl().
 */
export async function importFromJsonl(
	instance: PiInstance,
	inputPath: string,
): Promise<{ cancelled: boolean }> {
	const resolvedPath = resolve(inputPath);
	if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);

	const sessionDir = instance.session.sessionManager.getSessionDir();
	if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

	const destinationPath = join(sessionDir, basename(resolvedPath));

	// Emit before_switch for extension cancellation
	const runner = instance.session.extensionRunner;
	if (runner?.hasHandlers("session_before_switch")) {
		const result = await runner.emit({
			type: "session_before_switch",
			reason: "resume",
			targetSessionFile: destinationPath,
		} as any);
		if ((result as any)?.cancel === true) return { cancelled: true };
	}

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

// ── Instance creation ───────────────────────────────────────────────────────

async function buildInstance(cwd: string, options?: GetOrCreatePiOptions): Promise<PiInstance> {
	const settingsManager = SettingsManager.create(cwd);
	const resourceLoader = new DefaultResourceLoader({ cwd, settingsManager });
	await resourceLoader.reload();

	const sessionManager = options?.sessionPath
		? SessionManager.open(options.sessionPath)
		: SessionManager.continueRecent(cwd);

	const registry = getModelRegistry();
	const model = options?.provider && options.modelId ? registry.find(options.provider, options.modelId) : undefined;

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: options?.thinkingLevel,
		authStorage: getAuthStorage(),
		modelRegistry: registry,
		sessionManager,
		settingsManager,
		resourceLoader,
	});

	const listeners = new Set<PiEventListener>();

	// Create instance first — lifecycle helpers reference it via closures.
	const instance: PiInstance = {
		session,
		resourceLoader,
		settingsManager,
		listeners,
		extensionUiBridge: null as any, // set below
		unsubscribe: null as any, // set below
		cwd,
		createdAt: Date.now(),
		lastActivityAt: Date.now(),
	};

	instance.extensionUiBridge = makeExtensionUiBridge(instance);
	const emitToListeners = makeEmitter(instance);
	instance.unsubscribe = session.subscribe((event) => {
		emitToListeners(event);
	});

	await bindExtensionsOnSession(instance, session);

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
			const model = getModelRegistry().find(options.provider, options.modelId);
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

export async function listSessions(cwd?: string): Promise<PiSessionInfo[]> {
	const sessions = cwd ? await SessionManager.list(normalizeCwd(cwd)) : await SessionManager.listAll();
	const mapped = sessions.map(mapSessionInfo);
	await enrichSessionsWithStats(mapped);
	return mapped;
}

export async function listProjects(): Promise<ProjectSummary[]> {
	const sessions = await SessionManager.listAll();
	const byPath = new Map<string, { path: string; name: string; lastOpened: number }>();

	for (const session of sessions) {
		const cwd = session.cwd;
		if (!cwd) continue;

		const path = resolve(cwd);
		const lastOpened = session.modified.getTime();
		const existing = byPath.get(path);

		if (!existing || lastOpened > existing.lastOpened) {
			byPath.set(path, {
				path,
				name: basename(path) || path,
				lastOpened,
			});
		}
	}

	return Array.from(byPath.values())
		.sort((a, b) => b.lastOpened - a.lastOpened)
		.map((p) => ({
			id: p.path,
			name: p.name,
			path: p.path,
			lastOpened: p.lastOpened,
		}));
}

export function listAvailableModels(): PiModelPayload[] {
	return getModelRegistry().getAvailable().map(mapModel);
}

export function listAllModels(): PiModelPayload[] {
	return getModelRegistry().getAll().map(mapModel);
}

export function refreshModels(): void {
	getModelRegistry().refresh();
}

export async function isPiAvailable(): Promise<PiAvailability> {
	try {
		const models = getModelRegistry().getAvailable();
		drainAuthStorageErrors();
		return {
			available: true,
			authenticated: models.length > 0,
			modelCount: models.length,
			version: VERSION,
		};
	} catch {
		drainAuthStorageErrors();
		return {
			available: false,
			authenticated: false,
			modelCount: 0,
		};
	}
}

export async function deleteSession(sessionPath: string): Promise<boolean> {
	const resolvedPath = resolve((sessionPath || "").trim());
	const sessionsRoot = getSessionsRoot();

	if (!resolvedPath.endsWith(".jsonl")) return false;
	if (resolvedPath !== sessionsRoot && !resolvedPath.startsWith(`${sessionsRoot}${sep}`)) return false;

	try {
		await rm(resolvedPath, { force: true });

		for (const instance of instances.values()) {
			const currentFile = instance.session.sessionFile ? resolve(instance.session.sessionFile) : null;
			if (currentFile === resolvedPath) {
				await createNewSession(instance);
			}
		}

		return true;
	} catch {
		return false;
	}
}

export async function applySettings(instance: PiInstance, settings: Record<string, unknown>): Promise<void> {
	instance.settingsManager.applyOverrides(settings);
	await instance.settingsManager.flush();
	await instance.session.reload();
}

export function getSettings(instance: PiInstance): Record<string, unknown> {
	return {
		global: instance.settingsManager.getGlobalSettings(),
		project: instance.settingsManager.getProjectSettings(),
	};
}

export function mapStatePayload(instance: PiInstance): PiStatePayload {
	return {
		model: instance.session.model ? mapModel(instance.session.model) : null,
		thinkingLevel: instance.session.thinkingLevel,
		isStreaming: instance.session.isStreaming,
		isCompacting: instance.session.isCompacting,
		isRetrying: instance.session.isRetrying,
		sessionFile: instance.session.sessionFile ?? null,
		sessionId: instance.session.sessionId,
		sessionName: instance.session.sessionName ?? null,
		steeringMode: instance.session.steeringMode,
		followUpMode: instance.session.followUpMode,
		autoCompactionEnabled: instance.session.autoCompactionEnabled,
		autoRetryEnabled: instance.session.autoRetryEnabled,
		messageCount: instance.session.messages.length,
		pendingMessageCount: instance.session.pendingMessageCount,
		isBashRunning: instance.session.isBashRunning,
		hasPendingBashMessages: instance.session.hasPendingBashMessages,
		retryAttempt: instance.session.retryAttempt,
	};
}

export function listActiveRuntimeStates(): PiActiveRuntimeState[] {
	return Array.from(instances.values()).map((instance) => ({
		cwd: instance.cwd,
		state: mapStatePayload(instance),
	}));
}

export function listCommands(instance: PiInstance): PiCommandPayload[] {
	const skills = instance.resourceLoader.getSkills().skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
		source: "skill" as const,
		location: inferLocation(skill.filePath, instance.cwd),
		path: skill.filePath,
	}));

	const prompts = instance.resourceLoader.getPrompts().prompts.map((prompt) => ({
		name: prompt.name,
		description: prompt.description,
		source: "prompt" as const,
		location: inferLocation(prompt.filePath, instance.cwd),
		path: prompt.filePath,
	}));

	const extensionCommands =
		instance.session.extensionRunner?.getRegisteredCommands().map((command) => ({
			name: command.name,
			description: command.description,
			source: "extension" as const,
			location: inferLocation(command.sourceInfo.path, instance.cwd),
			path: command.sourceInfo.path,
		})) ?? [];

	return [...skills, ...prompts, ...extensionCommands];
}

export function mapForkMessages(instance: PiInstance): PiForkMessagePayload[] {
	return instance.session.getUserMessagesForForking().map((message) => ({
		entryId: message.entryId,
		text: message.text,
	}));
}

const inferLocation = (filePath: string | undefined, cwd: string): "user" | "project" | "path" | undefined => {
	if (!filePath) return undefined;

	const normalized = resolve(filePath);
	const normalizedCwd = normalizeCwd(cwd);
	const normalizedAgentDir = resolve(getAgentDir());

	if (normalized === normalizedCwd || normalized.startsWith(`${normalizedCwd}${sep}`)) {
		return "project";
	}

	if (normalized === normalizedAgentDir || normalized.startsWith(`${normalizedAgentDir}${sep}`)) {
		return "user";
	}

	return "path";
};

export function mapSessionInfo(session: SessionInfo): PiSessionInfo {
	return {
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name,
		parentSessionPath: session.parentSessionPath,
		created: session.created.getTime(),
		modified: session.modified.getTime(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
		allMessagesText: session.allMessagesText,
		// summary is populated asynchronously by enrichSessionsWithStats()
	};
}

/** Enrich a list of Pi sessions with diff stats and subagent tool counts (parallel, cached by mtime). */
export async function enrichSessionsWithStats(sessions: PiSessionInfo[]): Promise<void> {
	const { countSubagentTools } = await import("./pi/pi-session-stats");
	await Promise.all(
		sessions.map(async (session) => {
			if (!session.path) return;
			const [summary, toolCount] = await Promise.all([
				computePiSessionStats(session.path),
				countSubagentTools(session.path),
			]);
			if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
				session.summary = summary;
			}
			if (toolCount > 0) {
				session.subagentToolCount = toolCount;
			}
		}),
	);
}

export function mapModel(model: Model<any>): PiModelPayload {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		api: String(model.api),
		contextWindow: Number(model.contextWindow ?? 0),
		maxTokens: Number(model.maxTokens ?? 0),
		reasoning: Boolean(model.reasoning),
		input: Array.isArray(model.input) ? model.input.map((entry) => String(entry)) : ["text"],
		cost: {
			input: Number(model.cost?.input ?? 0),
			output: Number(model.cost?.output ?? 0),
			cacheRead: Number(model.cost?.cacheRead ?? 0),
			cacheWrite: Number(model.cost?.cacheWrite ?? 0),
		},
		authenticated: getModelRegistry()
			.getAvailable()
			.some((m) => m.id === model.id && m.provider === model.provider),
		isOAuth: getModelRegistry().isUsingOAuth(model),
	};
}

/**
 * Resolve a Pi session ID to the JSONL file path on disk.
 * Returns null if the session file cannot be found.
 */
export async function resolveSessionFilePath(sessionId: string): Promise<string | null> {
	// First check bridge-owned instances
	for (const instance of instances.values()) {
		if (instance.session.sessionId === sessionId && instance.session.sessionFile) {
			return resolve(instance.session.sessionFile);
		}
	}

	// Search the sessions directory
	try {
		const sessions = await SessionManager.listAll();
		for (const session of sessions) {
			if (session.id === sessionId && session.path) {
				return resolve(session.path);
			}
		}
	} catch {
		// ignore
	}

	return null;
}

/** Check if a Pi session is owned by the bridge (has an active instance). */
export function isSessionOwnedByBridge(sessionId: string): boolean {
	for (const instance of instances.values()) {
		if (instance.session.sessionId === sessionId) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a Pi session is actively streaming through a bridge-owned instance.
 * This is stricter than isSessionOwnedByBridge — returns true ONLY if the
 * bridge instance is currently processing a prompt (isStreaming). An idle
 * instance (e.g. created by pi_get_state after a bridge restart) returns false,
 * allowing the external tail to run instead.
 */
export function isSessionActivelyStreaming(sessionId: string): boolean {
	for (const instance of instances.values()) {
		if (instance.session.sessionId === sessionId && instance.session.isStreaming) {
			return true;
		}
	}
	return false;
}

export { mapAgentMessage, mapToolResult, translateEvent } from "./pi/pi-events";
