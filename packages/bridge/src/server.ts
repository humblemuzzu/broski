import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
// Extracted modules
import { type AuthTokenState, createNewAuthState, validateAuthToken } from "./auth-token";
import { startClaudeCodeExternalTail as _startClaudeCodeExternalTail } from "./cc-external-tail";
import * as claudeCode from "./connectors/claude-code";
import { CodexAppServerClient, checkCodexAvailable } from "./connectors/codex";
import * as codexFs from "./connectors/codex-fs";
import type { OpenCodeConnector } from "./connectors/opencode";
import * as pi from "./connectors/pi";
import { startCodexExternalTail as _startCodexExternalTail } from "./cx-external-tail";
import {
	listFilesDirectly as _listFilesDirectly,
	readFileBinaryDirectly as _readFileBinaryDirectly,
	readFileDirectly as _readFileDirectly,
} from "./file-ops";
import * as fileSearch from "./file-search";
import { maybeSynthesizeAskUserQuestion } from "./handlers/cc_ask_user_question";
import type { ClaudeElicitationReply } from "./handlers/cc_elicitation";
import { CcFsWatcherRegistry, type CcFsWatchKind } from "./handlers/cc_fs_watchers";
import { installCcHook, uninstallCcHook } from "./handlers/cc_hook_installer";
import { type CcPermissionHookContext, handleCcPermissionHook } from "./handlers/cc_permission_hook";
import { buildCodexApprovalDecision } from "./handlers/codex/approval-decision";
import { extractCodexErrorDetails } from "./handlers/codex/cx_error_extract";
import { mapCodexThreadFromSdk } from "./handlers/codex/map-thread";
import { handleCodexRuntimeNotification } from "./handlers/codex/runtime-notifications";
import { installCxHook, uninstallCxHook } from "./handlers/cx_hook_installer";
import { type CxPermissionHookContext, handleCxPermissionHook } from "./handlers/cx_permission_hook";
import * as cxRouting from "./handlers/cx_routing";
import * as piDurable from "./handlers/pi_durable";
import * as piFeatures from "./handlers/pi_features";
import { createFetchHandler, type FetchHandlerDeps, type HandleHttpDeps } from "./http-handler";
import { buildProxyPortAllowlist, toErrorMessage, toPublicErrorMessage } from "./http-utils";
import { releaseFailedBindResources, stopBridgeResources } from "./lifecycle/bridge-teardown";
import { DEFAULT_TEARDOWN_TIMEOUT_MS, type TeardownResult } from "./lifecycle/teardown";
import type { BridgeLogger } from "./logging/logger";
import { getTailscaleIPViaCli, interfaceFingerprint, readLocalEndpoints } from "./network";
import { EndpointWatcher } from "./network/endpoint-watcher";
import { startOpenCodeExternalTail as _startOpenCodeExternalTail } from "./oc-external-tail";
import { isCompiledBinary } from "./platform";
import { PtyManager } from "./pty/manager";
import { PtyRuntime } from "./pty/runtime";
import { createMessageRegistry } from "./routing/routes";
import type { ServerDeps } from "./routing/types";
import { invalidPayloadError, validateMessageShape } from "./routing/validate";
import { mapClaudeCodeStreamToRuntimeEvent } from "./runtime/claude-code-runtime-event-mapper";
import {
	buildClaudeCodeRuntimeState,
	mapClaudeCodeModelToSummary,
	mapClaudeCodeSessionToRuntimeSession,
} from "./runtime/claude-code-runtime-read-models";
import { mapCodexStreamToRuntimeEvent } from "./runtime/codex-runtime-event-mapper";
import { buildCodexRuntimeState, mapCodexThreadToRuntimeSession } from "./runtime/codex-runtime-read-models";
import {
	createOpenCodeMapperContext,
	mapOpenCodeSdkEventToRuntimeEvent,
} from "./runtime/opencode-runtime-event-mapper";
import { mapOpenCodeStatusToRuntimeState } from "./runtime/opencode-runtime-read-models";
import {
	buildPiActiveRuntimeStateMessages,
	findPiActiveRuntimeStateMessage,
	listPiActiveSessionSnapshots,
} from "./runtime/pi-runtime-bootstrap";
import {
	getSecurePath,
	hasPrototypePoisonKeys,
	isLoopbackAddress,
	isSafeClaudeCommandName,
	isTailscaleAddress,
	resolveClaudeCommandFilePath,
} from "./security";
import { BoundedMap, registerSweepable, sweepBoundedState } from "./state/bounded-map";
import { ensureTlsMaterial, isTlsEnabledByEnv, type TlsMaterial } from "./tls";
import { PiDurableSocketPool } from "./transport/pi-durable-socket";
import { RuntimeEventCoalescer } from "./transport/runtime-event-coalescer";
import { deliverRuntimeEvent } from "./transport/session-delivery";
import type {
	AgentStatusInfo,
	AgentType,
	ClaudeCodeStreamMessage,
	ClientMessage,
	CodexStreamMessage,
	CodexThread,
	DeviceInfo,
	PermissionResponse,
	ServerMessage,
} from "./types";
import { resetUnsupportedParams } from "./utils/codex-compat-retry";
import { recordRuntimeEvent, replayRuntimeEventsSince } from "./utils/runtime-replay-buffer";
import { RuntimeSendQueue } from "./utils/runtime-send-queue";

// Re-export for backward compatibility (external consumers import from './server')
export { type AuthTokenState, loadOrCreateAuthState, loadOrCreateAuthToken } from "./auth-token";

// Debug flags are dev-only — disabled in compiled binaries to prevent leaking
// session IDs, file paths, and internal state in production console output.
// All log calls go through the leveled logger (logUser/logInfo/logDebug/logError)
// which writes to the log file always and filters console output by level.
const DEBUG_RTS = !isCompiledBinary() && process.env.BROSKI_DEBUG_RTS === "1";
const DEBUG_CX_GLOBAL = !isCompiledBinary() && process.env.BROSKI_DEBUG_CX_GLOBAL === "1";
const BRIDGE_PROTOCOL_VERSION = "1.0.0";

function safeString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function mapCodexThread(thread: any, nameOverride?: string): CodexThread & { threadName?: string } {
	return mapCodexThreadFromSdk({ thread, nameOverride, safeString });
}

// File operations: thin wrappers binding getSecurePath to extracted functions (file-ops.ts)
async function listFilesDirectly(filePath: string) {
	return _listFilesDirectly(filePath, getSecurePath);
}
async function readFileDirectly(filePath: string) {
	return _readFileDirectly(filePath, getSecurePath);
}
async function readFileBinaryDirectly(filePath: string, maxSizeMb?: number) {
	return _readFileBinaryDirectly(filePath, getSecurePath, maxSizeMb);
}

export type BridgeServerOptions = {
	port: number;
	opencode: OpenCodeConnector | null;
	currentAgent?: AgentType;
	version: string;
	auth: AuthTokenState;
	tokenTtlDays?: number;
	/**
	 * When true, also starts a loopback-only plaintext WS/HTTP server used for
	 * Tailscale Funnel (which terminates TLS at the edge and proxies to localhost).
	 */
	enableLoopbackInsecureServer?: boolean;
	restartOpenCode?: () => Promise<boolean>;
	/** @deprecated Use bridgeLogger instead. Kept for backward compat. */
	logger?: (message: string) => void;
	/** Leveled logger. If not provided, falls back to legacy `logger` as info-level. */
	bridgeLogger?: BridgeLogger;
};

export type BridgeServer = {
	broadcast: (message: ServerMessage) => void;
	enqueueSdkEvent: (event: unknown) => void;
	/** Resolves once every async cleanup finished or the teardown budget elapsed. */
	stop: (force?: boolean) => Promise<TeardownResult>;
	connections: () => number;
	port: () => number;
	funnelBackendPort: () => number | null;
	authToken: () => string;
	tls: () => { enabled: boolean; certSha256: string | null };
};

type ConnectionContext = {
	projectPath?: string;
	sessionId?: string;
	viewAgent?: AgentType;
	lastPongAt: number;
	lastRttMs: number;
	pendingPing?: { id: string; sentAt: number };
	connectionType: "local" | "tailscale" | "unknown";
	deviceId?: string;
	deviceName?: string;
	platform?: string;
	protocolVersion?: string;
	connectedAt: number;
};

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
	const { opencode, version, logger } = options;

	// ── Leveled logging ──────────────────────────────────────────────────
	// If a BridgeLogger was provided, use it directly (it handles its own
	// redaction, file writing, and console-level filtering).
	// Otherwise fall back to the legacy `logger` callback wrapped as info-level.
	const _bl = options.bridgeLogger;
	const _legacyLog = logger ? (msg: string) => logger(msg) : undefined;

	/** Always visible on user's console (compiled or dev). */
	function logUser(message: string): void {
		if (_bl) {
			_bl.user(message);
			return;
		}
		_legacyLog?.(message);
	}
	/** Visible in dev console; hidden in binary console. Always in log file. */
	function logInfo(message: string): void {
		if (_bl) {
			_bl.info(message);
			return;
		}
		_legacyLog?.(message);
	}
	/** Visible only with --verbose / DEBUG in dev console. Always in log file. */
	function logDebug(message: string): void {
		if (_bl) {
			_bl.debug(message);
			return;
		}
		_legacyLog?.(message);
	}
	/** Always visible on stderr + error log file. */
	function logError(message: string, ...args: unknown[]): void {
		if (_bl) {
			_bl.error(message, ...args);
			return;
		}
		if (args.length > 0) {
			console.error(message, ...args);
		} else {
			console.error(message);
		}
	}
	// Backward-compat alias — existing `log(...)` calls become info-level.
	const log = logInfo;

	const sockets = new Set<ServerWebSocket<unknown>>();
	const contexts = new Map<ServerWebSocket<unknown>, ConnectionContext>();
	const compiled = isCompiledBinary();

	// Web dashboard dist directory (served by bridge HTTP when present).
	const webDistDir = (() => {
		const fromEnv = safeString(process.env.BROSKI_WEB_DIST).trim();
		if (fromEnv) return resolve(fromEnv);
		// repo layout: packages/bridge/src -> ../../web-app/dist
		return resolve(import.meta.dir, "..", "..", "web-app", "dist");
	})();

	// Permission/approval timeout: 10 minutes.
	// Users may background the app for extended periods; auto-rejecting after 2 minutes
	// kills long-running sessions that need approval. 10 min gives enough time for
	// app background → resume → approve flow, even on slow networks.
	const PERMISSION_TIMEOUT_MS = 600_000; // 10 minutes
	const CX_ITEM_CACHE_MAX = 5000; // Prevent unbounded growth of Codex item cache
	const CX_ITEM_CACHE_PRUNE = 1000; // Evict oldest 20% on overflow
	const MAX_BATCH_SIZE = 50; // DoS guard: reject oversized batch envelopes

	const ccEventBuffers = new Map<string, Array<{ event: any; ts: number }>>();
	const cxEventBuffers = new Map<string, Array<{ event: any; ts: number }>>();

	// Dedupe chat prompts (prevents resend storms on flaky networks).
	const recentChatMessageIds = new Map<string, number>(); // key: `${sessionId}:${messageId}` -> tsMs
	const ptyManager = new PtyManager(opencode);
	const sessionWatchers = new Map<string, Set<ServerWebSocket<unknown>>>();
	const ccExternalTails = new Map<string, { stop: () => void }>(); // sessionId -> tailer
	const cxExternalTails = new Map<string, { stop: () => void }>(); // threadId -> tailer
	const ocExternalTails = new Map<string, { stop: () => void }>(); // sessionId -> tailer (OpenCode)
	type ClaudePermissionReply = {
		response: "once" | "always" | "reject";
		updatedInput?: Record<string, unknown>;
	};
	const ccPermissionWaiters = new Map<string, { resolve: (response: ClaudePermissionReply) => void; timer: Timer }>();
	const ccElicitationWaiters = new Map<string, { resolve: (response: ClaudeElicitationReply) => void; timer: Timer }>();
	type CodexApprovalReply = {
		response?: PermissionResponse;
		execpolicyAmendment?: any;
		networkPolicyAmendment?: { host: string; action: "allow" | "deny" };
		answers?: Record<string, { answers: string[] }>;
	};
	const cxApprovalWaiters = new Map<string, { resolve: (response: CodexApprovalReply) => void; timer: Timer }>();
	const ccSessionOwners = new Map<string, ServerWebSocket<unknown>>();
	const cxThreadOwners = new Map<string, ServerWebSocket<unknown>>();
	const ocSessionOwners = new Map<string, ServerWebSocket<unknown>>();
	const cxItemCache = new Map<string, any>(); // key: `${threadId}:${turnId}:${itemId}` -> item

	// Per-session bookkeeping a daemon accumulates over weeks. Every entry is looked up whenever its
	// session is used, so a cap plus a sweep only ever drops sessions nobody touched in a long time.
	const SESSION_STATE_MAX_ENTRIES = 2000;
	const UNDO_STATE_TTL_MS = 24 * 60 * 60 * 1000;
	const ocSessionProjectPaths = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const ccSessionCwds = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxActiveTurns = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxThreadCwds = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxThreadNames = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxSearchSessions = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxFileChangeSnapshots = new BoundedMap<string, string>({
		maxEntries: 5000,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxUndoStackByThread = new BoundedMap<string, string[]>({
		maxEntries: 500,
		ttlMs: UNDO_STATE_TTL_MS,
	});

	const registerState = <K, V>(name: string, map: BoundedMap<K, V>): (() => void) =>
		registerSweepable({
			name,
			sweep: (now) => map.sweep(now),
			size: () => map.size,
			limit: () => map.stats().maxEntries,
		});

	const unregisterBoundedState = [
		registerState("oc-session-project-paths", ocSessionProjectPaths),
		registerState("cc-session-cwds", ccSessionCwds),
		registerState("cx-active-turns", cxActiveTurns),
		registerState("cx-thread-cwds", cxThreadCwds),
		registerState("cx-thread-names", cxThreadNames),
		registerState("cx-search-sessions", cxSearchSessions),
		registerState("cx-file-change-snapshots", cxFileChangeSnapshots),
		registerState("cx-undo-stacks", cxUndoStackByThread),
	];

	// Codex caching for fast session/project loading (mirrors OpenCode's 5s TTL pattern)
	// Project cache has longer TTL since projects rarely change
	const CODEX_THREAD_CACHE_TTL_MS = 5000; // 5 seconds
	const CODEX_PROJECT_CACHE_TTL_MS = 30000; // 30 seconds
	type CxThreadCacheEntry = {
		data: any[];
		fetchedAt: number;
		nextCursor: string | null;
	};
	type CxProjectCacheEntry = { data: any[]; fetchedAt: number };
	const cxThreadCache = new Map<string, CxThreadCacheEntry>(); // key: cwd or '__all__' -> threads
	let cxProjectCache: CxProjectCacheEntry | null = null;

	/** Invalidate Codex caches (called on mutations) */
	const invalidateCodexCaches = (cwd?: string) => {
		// Always invalidate project cache on any mutation
		cxProjectCache = null;
		// Invalidate thread caches
		if (cwd) {
			cxThreadCache.delete(cwd);
			cxThreadCache.delete(resolve(cwd));
		}
		cxThreadCache.delete("__all__");
	};

	let codexClient: CodexAppServerClient | null = null;

	const requireOpenCode = (): OpenCodeConnector => {
		if (!opencode) {
			throw new Error(
				"OpenCode backend is not available on this machine. Install OpenCode (or start it and attach), or switch to Claude Code / Codex in the app.",
			);
		}
		return opencode;
	};

	const BACKEND_STATUS_TTL_MS = 1500;
	let backendsCache: {
		fetchedAt: number;
		data: Record<AgentType, AgentStatusInfo>;
	} | null = null;
	let backendsInFlight: Promise<Record<AgentType, AgentStatusInfo>> | null = null;

	const getBackendsStatus = async (): Promise<Record<AgentType, AgentStatusInfo>> => {
		const now = Date.now();
		if (backendsCache && now - backendsCache.fetchedAt <= BACKEND_STATUS_TTL_MS) {
			return backendsCache.data;
		}
		if (backendsInFlight) return backendsInFlight;

		backendsInFlight = (async () => {
			const envKey = !!process.env.ANTHROPIC_API_KEY;

			const [ocOk, ccOk, cxOk, piStatus, piDurableStatus] = await Promise.all([
				(async () => {
					try {
						return opencode ? await opencode.isRunning() : false;
					} catch {
						return false;
					}
				})(),
				(async () => {
					try {
						return await claudeCode.checkClaudeCodeAvailable();
					} catch {
						return false;
					}
				})(),
				(async () => {
					try {
						return await checkCodexAvailable();
					} catch {
						return false;
					}
				})(),
				(async () => {
					try {
						return await pi.isPiAvailable();
					} catch {
						return {
							available: false,
							authenticated: false,
							modelCount: 0,
						} as const;
					}
				})(),
				piDurable.piDurableAvailability(),
			]);

			const data: Record<AgentType, AgentStatusInfo> = {
				opencode: { available: ocOk, version },
				"claude-code": {
					available: ccOk,
					authMethod: ccOk ? (envKey ? "api-key" : "claude-login") : undefined,
				},
				codex: { available: cxOk, authMethod: cxOk ? "cli" : undefined },
				pi: {
					available: piStatus.available,
					authMethod: piStatus.authenticated ? "configured" : "not-configured",
					version: "version" in piStatus ? piStatus.version : undefined,
				},
				"pi-durable": {
					available: piDurableStatus.available,
					authMethod: piDurableStatus.authenticated ? "configured" : "not-configured",
				},
			};

			backendsCache = { fetchedAt: Date.now(), data };
			return data;
		})();

		try {
			return await backendsInFlight;
		} finally {
			backendsInFlight = null;
		}
	};

	// Default agent is detected from what's available, not hardcoded.
	// The Flutter app also auto-selects on connect, so this is just the
	// server-side default until the first client sets it explicitly.
	let currentAgent: AgentType = options.currentAgent || "opencode";

	// Detect actual default after backends probe (async, runs once)
	void (async () => {
		try {
			const backends = await getBackendsStatus();
			// Only override if no client has set an agent yet and the current default isn't available
			if (!backends[currentAgent]?.available) {
				if (backends["claude-code"]?.available) currentAgent = "claude-code";
				else if (backends.opencode?.available) currentAgent = "opencode";
				else if (backends.codex?.available) currentAgent = "codex";
				else if (backends.pi?.available) currentAgent = "pi";
			}
		} catch {
			// keep default
		}
	})();
	const lastGitBranchByProject = new Map<string, string>();

	let authState: AuthTokenState = options.auth;
	let authToken = authState.token;
	let authExpiresAt = authState.expiresAt;
	// Never allow token-in-URL in production binaries.
	const allowTokenInUrl = !compiled && process.env.BROSKI_ALLOW_TOKEN_IN_URL === "1";
	// Bridge is open-source — no cloud auth or paid-access checks.
	// In production binaries, always enable TLS for any non-loopback access.
	// Allowing BROSKI_TLS=0 creates sniffing/MITM risk on WiFi/hotspot.
	const tlsEnabled = compiled ? true : isTlsEnabledByEnv();
	let tlsMaterial: TlsMaterial | null = null;

	// Claude Code filesystem watchers (skills/plugins/hook/command updates).
	const ccFsWatchers = new CcFsWatcherRegistry({
		onChange: (change) => {
			broadcast({ type: "cc_fs_changed", data: change });
		},
	});
	const ensureClaudeWatchDir = (dir: string, kind: CcFsWatchKind, cwd?: string, recursive = true): void => {
		ccFsWatchers.ensure(dir, kind, cwd, recursive);
	};
	const runtimeSendQueue = new RuntimeSendQueue(
		(ws) => {
			const ctx = contexts.get(ws);
			if (!ctx) return undefined;
			return {
				lastRttMs: ctx.lastRttMs,
				connectionType: ctx.connectionType,
			};
		},
		{
			// A socket that dropped a frame or fell too far behind is not reading: close it so the
			// app reconnects and resyncs through set_view + lastRuntimeSeq.
			onDeadSocket: (ws, reason) => {
				logInfo(`[WS] Shedding socket (${reason})`);
				try {
					ws.close(1013, "backpressure");
				} catch {
					// already gone
				}
			},
		},
	);

	const piDurableSockets = new PiDurableSocketPool(runtimeSendQueue);

	const send = (ws: ServerWebSocket<unknown>, message: ServerMessage) => {
		runtimeSendQueue.send(ws, message);
	};

	const deliverRuntimeEventMessage = (message: ServerMessage, owner?: ServerWebSocket<unknown> | null): void => {
		if (message.type !== "runtime_event") return;
		const sessionId = message.data.sessionId;
		const key = makeSessionKey(message.backend, sessionId);
		const ownerMap =
			message.backend === "claude-code" ? ccSessionOwners : message.backend === "codex" ? cxThreadOwners : null;
		deliverRuntimeEvent({
			message,
			owner: owner ?? (ownerMap && sessionId ? ownerMap.get(sessionId) : null),
			viewers: key ? sessionWatchers.get(key) : undefined,
			sockets,
			send,
		});
	};

	// Delta bursts are merged before they are recorded, so the replay buffer holds exactly what
	// the sockets received.
	const runtimeCoalescer = new RuntimeEventCoalescer((message, owner) => {
		recordRuntimeEvent(message);
		deliverRuntimeEventMessage(message, owner);
	});

	const broadcast = (message: ServerMessage) => {
		if (message.type === "runtime_event") {
			runtimeCoalescer.push(message);
			return;
		}
		runtimeSendQueue.broadcast(sockets, message);
	};

	const ptyRuntime = new PtyRuntime({
		ptyManager,
		send,
		log,
		resolveSecurePath: getSecurePath,
	});

	const replayRuntimeEventsForSocket = (params: {
		ws: ServerWebSocket<unknown>;
		backend: AgentType;
		sessionId?: string;
		cwd?: string;
		lastSeq?: number;
	}): number => {
		const replayed = replayRuntimeEventsSince({
			backend: params.backend,
			sessionId: params.sessionId,
			cwd: params.cwd,
			lastSeq: params.lastSeq,
		});
		for (const message of replayed) {
			send(params.ws, message);
		}
		return replayed.length;
	};

	// Watch user-scope Claude Code skills (best-effort).
	ensureClaudeWatchDir(join(homedir(), ".claude", "skills"), "skills");

	const ensureUndoStack = (threadId: string) => {
		const existing = cxUndoStackByThread.get(threadId);
		if (existing) return existing;
		const created: string[] = [];
		cxUndoStackByThread.set(threadId, created);
		return created;
	};

	const safeResolveInCwd = (cwd: string, relativePath: string): string => {
		const abs = resolve(cwd, relativePath);
		const normalizedCwd = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`;
		if (abs === cwd || abs.startsWith(normalizedCwd)) return abs;
		return resolve(cwd, relativePath.replace(/^\/*/, ""));
	};

	type FileSnapshotEntry = {
		path: string;
		kind: "add" | "delete" | "update";
		movePath?: string | null;
		existed: boolean;
		contentFile?: string | null;
		targetExisted?: boolean;
		targetContentFile?: string | null;
	};

	const snapshotCodexFileChange = async (
		threadId: string,
		turnId: string,
		itemId: string,
		item: any,
	): Promise<void> => {
		const cwd = cxThreadCwds.get(threadId);
		if (!cwd) return;
		const changes = Array.isArray(item?.changes) ? item.changes : [];
		if (changes.length === 0) return;

		const baseDir = resolve(cwd, ".broski", "codex-undo", threadId, turnId, itemId);
		const filesDir = resolve(baseDir, "files");
		await mkdir(filesDir, { recursive: true });

		const entries: FileSnapshotEntry[] = [];
		let idx = 0;

		for (const c of changes) {
			const relPath = safeString(c?.path);
			const kindObj = c?.kind;
			const kindType = safeString(kindObj?.type).toLowerCase();
			const kind: FileSnapshotEntry["kind"] = kindType === "add" ? "add" : kindType === "delete" ? "delete" : "update";
			const movePathRaw = safeString(kindObj?.movePath);
			const movePath = movePathRaw ? movePathRaw : null;

			const absPath = safeResolveInCwd(cwd, relPath);
			let existed = false;
			let contentFile: string | null = null;
			try {
				await stat(absPath);
				existed = true;
				const buf = await readFile(absPath);
				const name = `orig_${idx}.bin`;
				await writeFile(resolve(filesDir, name), buf);
				contentFile = name;
			} catch {
				existed = false;
			}

			let targetExisted: boolean | undefined;
			let targetContentFile: string | null = null;
			if (movePath) {
				const targetAbs = safeResolveInCwd(cwd, movePath);
				try {
					await stat(targetAbs);
					targetExisted = true;
					const buf = await readFile(targetAbs);
					const name = `target_${idx}.bin`;
					await writeFile(resolve(filesDir, name), buf);
					targetContentFile = name;
				} catch {
					targetExisted = false;
				}
			}

			entries.push({
				path: relPath,
				kind,
				movePath,
				existed,
				contentFile,
				...(movePath ? { targetExisted, targetContentFile } : {}),
			});
			idx++;
		}

		const manifest = {
			threadId,
			turnId,
			itemId,
			cwd,
			createdAt: Math.floor(Date.now() / 1000),
			entries,
		};
		const manifestPath = resolve(baseDir, "manifest.json");
		await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

		const key = `${threadId}:${turnId}:${itemId}`;
		cxFileChangeSnapshots.set(key, manifestPath);
	};

	const applyCodexUndo = async (threadId: string, key: string): Promise<string[]> => {
		const manifestPath = cxFileChangeSnapshots.get(key);
		if (!manifestPath) return [];
		const raw = await readFile(manifestPath, "utf8");
		const parsed = JSON.parse(raw) as {
			cwd: string;
			entries: FileSnapshotEntry[];
		};
		const secureCwd = await getSecurePath(parsed.cwd);
		if (!secureCwd) return [];
		const cwd = secureCwd;
		const reverted: string[] = [];
		const filesDir = resolve(dirname(manifestPath), "files");

		const restoreFile = async (rel: string, existed: boolean, contentFile?: string | null) => {
			const abs = safeResolveInCwd(cwd, rel);
			if (!existed) {
				await rm(abs, { force: true });
				reverted.push(rel);
				return;
			}
			if (!contentFile) return;
			const buf = await readFile(resolve(filesDir, contentFile));
			await mkdir(dirname(abs), { recursive: true });
			await writeFile(abs, buf);
			reverted.push(rel);
		};

		for (const e of parsed.entries) {
			if (e.kind === "update" && e.movePath) {
				await restoreFile(e.movePath, e.targetExisted === true, e.targetContentFile);
				await restoreFile(e.path, e.existed, e.contentFile);
			} else {
				await restoreFile(e.path, e.existed, e.contentFile);
			}
		}

		const stack = ensureUndoStack(threadId);
		const idx = stack.lastIndexOf(key);
		if (idx >= 0) stack.splice(idx, 1);
		cxFileChangeSnapshots.delete(key);
		return reverted;
	};

	const ensureCodexClient = async () => {
		if (!codexClient) {
			codexClient = new CodexAppServerClient();
			codexClient.setHandlers({
				onNotification: (n) => {
					const params: any = n.params ?? {};
					// Codex app-server protocol places threadId in different locations by notification type
					let threadId = safeString(params.threadId ?? params.thread_id ?? params.threadID);
					const turnId = safeString(params.turnId ?? params.turn_id ?? params.turnID);

					if (n.method === "thread/started") {
						const thread = params.thread;
						const id = safeString(thread?.id);
						const cwd = safeString(thread?.cwd);
						if (id && cwd) {
							void getSecurePath(cwd)
								.then((secure) => {
									if (secure) cxThreadCwds.set(id, secure);
								})
								.catch(() => {});
						}
						if (id && !threadId) threadId = id;
					}

					// #19: Forward app/list/updated notification to all clients
					if (n.method === "app/list/updated") {
						const appData = params.data ?? params;
						for (const ws of sockets) {
							send(ws, {
								type: "cx_apps_updated",
								data: Array.isArray(appData) ? appData : [],
							});
						}
					}

					// Track thread names from thread/name/updated notifications (SDK ThreadNameUpdatedNotification)
					if (n.method === "thread/name/updated") {
						const nameThreadId = safeString(params.threadId);
						const threadName = safeString(params.threadName ?? params.name).trim();
						if (nameThreadId) {
							if (threadName) {
								cxThreadNames.set(nameThreadId, threadName);
							} else {
								cxThreadNames.delete(nameThreadId); // name cleared
							}
						}
					}

					handleCodexRuntimeNotification({
						method: n.method,
						params,
						sockets,
						send,
						safeString,
						cxThreadOwners,
						cxThreadCwds,
						cxThreadNames,
					});

					if (!threadId && params.turn?.threadId) {
						threadId = safeString(params.turn.threadId);
					}

					if (!threadId && params.item?.threadId) {
						threadId = safeString(params.item.threadId);
					}

					// Cache items for approval requests
					if (n.method === "item/started" || n.method === "item/completed") {
						const item = params.item;
						const itemId = safeString(item?.id);
						if (threadId && turnId && itemId) {
							cxItemCache.set(`${threadId}:${turnId}:${itemId}`, item);
							if (cxItemCache.size > CX_ITEM_CACHE_MAX) {
								const keys = [...cxItemCache.keys()];
								for (let i = 0; i < CX_ITEM_CACHE_PRUNE; i++) cxItemCache.delete(keys[i]!);
							}
							if (safeString(item?.type) === "fileChange" && n.method === "item/started") {
								void snapshotCodexFileChange(threadId, turnId, itemId, item).catch(() => {});
							}
							if (safeString(item?.type) === "fileChange" && n.method === "item/completed") {
								const status = safeString(item?.status).toLowerCase();
								const key = `${threadId}:${turnId}:${itemId}`;
								if (status.includes("completed") && cxFileChangeSnapshots.has(key)) {
									ensureUndoStack(threadId).push(key);
								} else {
									cxFileChangeSnapshots.delete(key);
								}
							}

							// Handle context compaction events
							if (safeString(item?.type) === "contextCompaction") {
								const compactionStatus = n.method === "item/started" ? "started" : "completed";
								logInfo(`[Codex] context compaction ${compactionStatus}: threadId=${threadId}`);
							}
						}
					}

					// Resolve owner EARLY so all downstream code can use it safely
					const owner = threadId ? cxThreadOwners.get(threadId) : null;

					// Track latest running turn for abort
					if (n.method === "turn/started") {
						const tid = safeString(params.turn?.id);
						if (threadId && tid) cxActiveTurns.set(threadId, tid);
					}
					if (n.method === "turn/completed") {
						const tid = safeString(params.turn?.id);
						if (threadId && tid && cxActiveTurns.get(threadId) === tid) {
							cxActiveTurns.delete(threadId);
							// Clear event buffer — turn is done, no more streaming gap risk
							cxEventBuffers.delete(threadId);
						}
					}

					// Log turn lifecycle events for debugging
					if (n.method === "turn/started") {
						logInfo(`[Codex] turn/started: threadId=${threadId}, turnId=${turnId}`);
					}
					if (n.method === "turn/completed") {
						const turnStatus = safeString(params.turn?.status).toLowerCase();
						const turnError = params.turn?.error;
						logInfo(`[Codex] turn/completed: threadId=${threadId}, turnId=${turnId}, status=${turnStatus}`);

						// Handle turn/completed with failed status (different from turn/failed notification)
						if (turnStatus === "failed" && turnError && threadId) {
							logError(`[Codex] turn/completed with failed status:`, JSON.stringify(turnError, null, 2));

							const errDetails = extractCodexErrorDetails(turnError, "turn_failed");
							emitCxStream(
								threadId,
								{
									type: "error",
									message: errDetails.errorMessage,
									code: errDetails.derivedErrorCode,
									details: turnError,
									modelCapModel: errDetails.modelCapModel,
									modelCapRetrySeconds: errDetails.modelCapRetrySeconds,
								},
								owner,
							);
						}
					}
					// Handle turn failures and errors - EMIT TO CLIENT, not just log!
					if (n.method === "turn/failed" || n.method === "error") {
						const turn = params.turn;
						const error = turn?.error ?? params.error ?? params;
						logError(`[Codex] ${n.method}: threadId=${threadId}`, JSON.stringify(error, null, 2));
						if (threadId) {
							cxActiveTurns.delete(threadId);

							// CRITICAL: Emit error to client so UI knows the turn failed
							const errDetails = extractCodexErrorDetails(error, n.method);
							emitCxStream(
								threadId,
								{
									type: "error",
									message: errDetails.errorMessage,
									code: errDetails.derivedErrorCode,
									details: error,
									modelCapModel: errDetails.modelCapModel,
									modelCapRetrySeconds: errDetails.modelCapRetrySeconds,
								},
								owner,
							);

							const runtimeStatePayload: ServerMessage = {
								type: "runtime_state",
								backend: "codex",
								data: buildCodexRuntimeState({
									threadId,
									cwd: cxThreadCwds.get(threadId),
									isStreaming: false,
								}),
							};
							if (owner) {
								send(owner, runtimeStatePayload);
							}
							broadcastToSessionWatchers("codex", threadId, runtimeStatePayload, owner);

							// Legacy sdk_event for session.idle removed in Phase 4.
							// UI state is now driven by runtime_state (sent above).
						}
					}
					// Handle thread/compacted (deprecated notification)
					if (n.method === "thread/compacted") {
						logInfo(`[Codex] thread/compacted (deprecated): threadId=${threadId}`);
						if (threadId) {
							emitCxStream(threadId, { type: "notification", method: "thread/compacted", params }, owner);
						}
					}

					// Log response items for debugging
					if (n.method === "item/started" || n.method === "item/completed") {
						const item = params.item;
						const itemType = safeString(item?.type);
						const itemId = safeString(item?.id);
						logInfo(`[Codex] ${n.method}: threadId=${threadId}, itemType=${itemType}, itemId=${itemId}`);
					}

					// Multi-Agent Collaboration Events (Codex SDK v0.87.0+)
					// EXPERIMENTAL: `collab/*` notifications are not part of the stable, documented
					// Codex protocol surface. We forward them for richer UI rendering, but they may
					// change or disappear in future SDK/app-server versions.
					if (n.method.startsWith("collab/")) {
						const collabMethod = n.method.replace("collab/", "").replace("/", "_");
						const collabData = {
							callId: safeString(params.call_id ?? params.callId),
							senderThreadId: safeString(params.sender_thread_id ?? params.senderThreadId ?? threadId),
							receiverThreadId: safeString(params.receiver_thread_id ?? params.receiverThreadId),
							receiverThreadIds: Array.isArray(params.receiver_thread_ids ?? params.receiverThreadIds)
								? (params.receiver_thread_ids ?? params.receiverThreadIds).map(safeString)
								: [],
							newThreadId: safeString(params.new_thread_id ?? params.newThreadId) || undefined,
							newAgentNickname: safeString(params.new_agent_nickname ?? params.newAgentNickname) || undefined,
							newAgentRole: safeString(params.new_agent_role ?? params.newAgentRole) || undefined,
							prompt: safeString(params.prompt),
							status: params.status,
							statuses: params.statuses,
						};
						const senderThread = collabData.senderThreadId || threadId;
						const collabOwner = senderThread ? cxThreadOwners.get(senderThread) : null;
						emitCxStream(
							senderThread || threadId,
							{ type: `collab_${collabMethod}`, data: collabData } as unknown as CodexStreamMessage,
							collabOwner,
						);
						return;
					}

					if (!threadId) {
						// Some notifications are global (no threadId): auth, rate limits, MCP oauth completion, etc.
						// NOTE: Codex app-server can emit extremely high-volume `codex/event/*` telemetry
						// (often duplicating the same information we already forward via `cx_stream`).
						// Forwarding this to every client can overwhelm mobile devices during streaming,
						// making “High” effort appear to hang. By default we drop `codex/event/*` and
						// only forward them when explicitly enabled for debugging.
						if (DEBUG_CX_GLOBAL || !n.method.startsWith("codex/event/")) {
							for (const ws of sockets) {
								send(ws, {
									type: "cx_global",
									data: { method: n.method, params },
								});
							}
						}
						return;
					}

					emitCxStream(threadId, { type: "notification", method: n.method, params }, owner);

					// Send busy/idle events for background indicators/notifications
					if (owner && n.method === "turn/started" && threadId) {
						const runtimeStatePayload: ServerMessage = {
							type: "runtime_state",
							backend: "codex",
							data: buildCodexRuntimeState({
								threadId,
								cwd: cxThreadCwds.get(threadId),
								isStreaming: true,
							}),
						};
						send(owner, runtimeStatePayload);
						broadcastToSessionWatchers("codex", threadId, runtimeStatePayload, owner);
						// Legacy sdk_event removed in Phase 4 — runtime_state (above) drives UI state.
					}
					if (owner && n.method === "turn/completed" && threadId) {
						const runtimeStatePayload: ServerMessage = {
							type: "runtime_state",
							backend: "codex",
							data: buildCodexRuntimeState({
								threadId,
								cwd: cxThreadCwds.get(threadId),
								isStreaming: false,
							}),
						};
						send(owner, runtimeStatePayload);
						broadcastToSessionWatchers("codex", threadId, runtimeStatePayload, owner);
						// Legacy sdk_event removed in Phase 4 — runtime_state (above) drives UI state.
					}
				},
				onServerRequest: async (r) => {
					const params: any = r.params ?? {};
					const requestMethod = String(r.method ?? "");
					const isLegacyPatchApproval = requestMethod === "applyPatchApproval";
					const isLegacyExecApproval = requestMethod === "execCommandApproval";
					const isLegacyApproval = isLegacyPatchApproval || isLegacyExecApproval;

					let threadId = safeString(
						params.threadId ?? params.thread_id ?? params.threadID ?? params.conversationId ?? params.conversation_id,
					);
					let turnId = safeString(params.turnId ?? params.turn_id ?? params.turnID);
					const itemId = safeString(params.itemId ?? params.item_id ?? params.itemID ?? params.callId);

					// skill/requestApproval does not currently include threadId in protocol params.
					// Recover it from cached item events: key format `${threadId}:${turnId}:${itemId}`.
					if (!threadId && requestMethod === "skill/requestApproval" && itemId) {
						for (const key of cxItemCache.keys()) {
							if (key.endsWith(`:${itemId}`)) {
								const [resolvedThreadId, resolvedTurnId] = key.split(":");
								threadId = resolvedThreadId ?? "";
								if (!turnId) turnId = resolvedTurnId ?? "";
								break;
							}
						}
					}
					if (!threadId && requestMethod === "skill/requestApproval" && cxThreadOwners.size === 1) {
						threadId = Array.from(cxThreadOwners.keys())[0] ?? "";
					}

					const owner = threadId ? cxThreadOwners.get(threadId) : null;

					// ── Handle item/tool/call (dynamic tool calls) ──
					// Protocol: DynamicToolCallParams = { threadId, turnId, callId, tool, arguments }
					// Response: DynamicToolCallResponse = { contentItems: DynamicToolCallOutputContentItem[], success: boolean }
					// We don't support dynamic tools yet — return a graceful error response
					if (requestMethod === "item/tool/call") {
						logInfo(`[Codex] Dynamic tool call received: ${safeString(params.tool)} — not supported, declining`);
						if (owner) {
							// Route through emitCxStream for runtime_event mapping
							emitCxStream(
								threadId,
								{
									type: "info",
									message: `Dynamic tool "${safeString(params.tool)}" was requested but is not yet supported by Broski.`,
								} satisfies CodexStreamMessage,
								owner,
							);
						}
						return {
							contentItems: [
								{
									type: "inputText",
									text: "Dynamic tool calls are not yet supported by Broski.",
								},
							],
							success: false,
						};
					}

					// ── Handle account/chatgptAuthTokens/refresh ──
					// Protocol: ChatgptAuthTokensRefreshParams = { reason, previousAccountId? }
					// Response: ChatgptAuthTokensRefreshResponse = { accessToken, chatgptAccountId, chatgptPlanType }
					// We don't manage ChatGPT auth tokens — return an error so Codex falls back
					if (requestMethod === "account/chatgptAuthTokens/refresh") {
						logInfo(`[Codex] ChatGPT auth token refresh requested — not supported`);
						throw new Error(
							"ChatGPT auth token refresh is not supported by Broski. Please re-authenticate via `codex` CLI.",
						);
					}

					if (!owner) {
						if (isLegacyApproval) {
							return { decision: "denied" };
						}
						return { decision: "decline" };
					}

					const cached = threadId && turnId && itemId ? cxItemCache.get(`${threadId}:${turnId}:${itemId}`) : null;

					// #29: Include structured approval context (command, cwd, commandActions, reason)
					// The SDK sends these in CommandExecutionRequestApprovalParams / FileChangeRequestApprovalParams.
					// Legacy requests (applyPatchApproval/execCommandApproval) are normalized to the same UI methods.
					const enrichedParams: any = {
						...params,
						cachedItem: cached,
						threadId,
						...(turnId ? { turnId } : {}),
						...(itemId ? { itemId } : {}),
					};

					// Ensure command & cwd from approval params are surfaced (they may differ from cachedItem)
					if (requestMethod === "item/commandExecution/requestApproval" || isLegacyExecApproval) {
						if (params.command && !enrichedParams.approvalCommand) enrichedParams.approvalCommand = params.command;
						if (params.cwd && !enrichedParams.approvalCwd) enrichedParams.approvalCwd = params.cwd;
						if (params.commandActions) enrichedParams.commandActions = params.commandActions;
						if (params.parsedCmd && !enrichedParams.commandActions) enrichedParams.commandActions = params.parsedCmd;
						const networkApprovalContext = params.networkApprovalContext ?? params.network_approval_context;
						if (networkApprovalContext && !enrichedParams.networkApprovalContext) {
							enrichedParams.networkApprovalContext = networkApprovalContext;
						}
						const proposedNetworkPolicyAmendments =
							params.proposedNetworkPolicyAmendments ?? params.proposed_network_policy_amendments;
						if (proposedNetworkPolicyAmendments && !enrichedParams.proposedNetworkPolicyAmendments) {
							enrichedParams.proposedNetworkPolicyAmendments = proposedNetworkPolicyAmendments;
						}
					}
					if (requestMethod === "item/fileChange/requestApproval" || isLegacyPatchApproval) {
						if (params.grantRoot) enrichedParams.grantRoot = params.grantRoot;
						if (params.fileChanges && !enrichedParams.fileChanges) enrichedParams.fileChanges = params.fileChanges;
					}
					if (requestMethod === "skill/requestApproval") {
						if (params.skillName && !enrichedParams.skillName) enrichedParams.skillName = params.skillName;
						if (params.itemId && !enrichedParams.itemId) enrichedParams.itemId = params.itemId;
					}

					const frontendMethod = isLegacyExecApproval
						? "item/commandExecution/requestApproval"
						: isLegacyPatchApproval
							? "item/fileChange/requestApproval"
							: requestMethod;

					// Route through emitCxStream so it maps to runtime_event
					emitCxStream(
						threadId,
						{
							type: "request",
							requestId: String(r.id),
							method: frontendMethod,
							params: enrichedParams,
						} satisfies CodexStreamMessage,
						owner,
					);

					const response = await new Promise<CodexApprovalReply>((resolve) => {
						const key = String(r.id);
						const timer = setTimeout(() => {
							cxApprovalWaiters.delete(key);
							resolve({ response: "reject" });
						}, PERMISSION_TIMEOUT_MS);
						cxApprovalWaiters.set(key, { resolve, timer });
					});

					return buildCodexApprovalDecision({
						requestMethod,
						isLegacyApproval,
						isLegacyExecApproval,
						response,
						requestParams: params,
						safeString,
					});
				},
				// Handle app-server crash - notify all affected clients
				onExit: (code, signal) => {
					logError(`[Codex] App-server crashed! code=${code}, signal=${signal}`);

					// Notify all thread owners that the server crashed
					for (const [threadId, owner] of cxThreadOwners.entries()) {
						emitCxStream(
							threadId,
							{
								type: "error",
								message: "Codex agent stopped unexpectedly. It will restart automatically on your next message.",
								code: "app_server_crashed",
							},
							owner,
						);

						// Emit runtime_state with isStreaming: false for the dead thread
						const runtimeStatePayload: ServerMessage = {
							type: "runtime_state",
							backend: "codex",
							data: buildCodexRuntimeState({
								threadId,
								cwd: cxThreadCwds.get(threadId),
								isStreaming: false,
							}),
						};
						send(owner, runtimeStatePayload);
						broadcastToSessionWatchers("codex", threadId, runtimeStatePayload, owner);

						// Legacy sdk_event removed in Phase 4 — runtime_state (above) drives UI state.
					}

					// Clean up all state
					cxThreadOwners.clear();
					cxActiveTurns.clear();
					cxEventBuffers.clear();
					cxApprovalWaiters.forEach((w) => {
						clearTimeout(w.timer);
						w.resolve({ response: "reject" });
					});
					cxApprovalWaiters.clear();

					// Reset client reference only if not auto-restarting
					// (connector handles restart internally when code !== 0)
					if (code === 0 || code === null) {
						codexClient = null;
					}
				},
				onError: (error) => {
					logError(`[Codex] App-server error:`, error.message);

					// Broadcast error to all connected clients
					for (const ws of sockets) {
						send(ws, {
							type: "cx_global",
							data: { method: "error", params: { message: error.message } },
						});
					}
				},
				onStatusChange: (status) => {
					// Reset compat-retry cache on successful restart
					if (status.alive) resetUnsupportedParams();
					// Broadcast Codex process status to all connected clients
					for (const ws of sockets) {
						send(ws, {
							type: "codex_process_status",
							data: status,
						} as any);
					}
				},
			});
		}

		await codexClient.start();
		return codexClient;
	};

	const stopCodexAppServer = async (): Promise<void> => {
		const client = codexClient;
		codexClient = null;
		if (client) await client.stop();
	};

	const getDeviceInfo = (ws: ServerWebSocket<unknown>): DeviceInfo | null => {
		const ctx = contexts.get(ws);
		if (!ctx?.deviceId) return null;
		return {
			deviceId: ctx.deviceId,
			deviceName: ctx.deviceName ?? "Unknown Device",
			platform: ctx.platform ?? "unknown",
			connectionType: ctx.connectionType,
			rttMs: ctx.lastRttMs,
			connectedAt: ctx.connectedAt,
			currentView:
				ctx.projectPath || ctx.sessionId ? { projectPath: ctx.projectPath, sessionId: ctx.sessionId } : undefined,
		};
	};

	const getAllDevices = (): DeviceInfo[] => {
		const devices: DeviceInfo[] = [];
		for (const ws of sockets) {
			const device = getDeviceInfo(ws);
			if (device) devices.push(device);
		}
		return devices;
	};

	const findSocketByDeviceId = (deviceId: string): ServerWebSocket<unknown> | null => {
		for (const ws of sockets) {
			const ctx = contexts.get(ws);
			if (ctx?.deviceId === deviceId) return ws;
		}
		return null;
	};

	const makeSessionKey = (agent: AgentType | undefined, sessionId: string | undefined): string | null => {
		if (!agent || !sessionId) return null;
		return `${agent}:${sessionId}`;
	};

	const parseSessionKey = (key: string): { agent: AgentType; id: string } | null => {
		const idx = key.indexOf(":");
		if (idx <= 0) return null;
		const agent = key.slice(0, idx) as AgentType;
		const id = key.slice(idx + 1);
		if (!id) return null;
		return { agent, id };
	};

	const stopExternalTail = (map: Map<string, { stop: () => void }>, id: string) => {
		const existing = map.get(id);
		if (!existing) return;
		try {
			existing.stop();
		} catch {
			// ignore
		}
		map.delete(id);
	};
	const stopCcExternalTail = (sessionId: string) => stopExternalTail(ccExternalTails, sessionId);
	const stopCxExternalTail = (threadId: string) => stopExternalTail(cxExternalTails, threadId);
	const stopOcExternalTail = (sessionId: string) => stopExternalTail(ocExternalTails, sessionId);

	/**
	 * OpenCode External Tail: Polls session messages to detect changes from external TUI sessions.
	 * When the TUI runs, events don't reach global.event() stream, so we poll the API instead.
	 */
	const startOpenCodeExternalTail = (sessionId: string, projectPath: string): { stop: () => void } => {
		return _startOpenCodeExternalTail(sessionId, projectPath, {
			oc: requireOpenCode(),
			enqueueSdkEvent,
			broadcastRaw: broadcast as (message: Record<string, unknown>) => void,
			logDebug,
			DEBUG_RTS,
		});
	};

	const startClaudeCodeExternalTail = (sessionId: string): { stop: () => void } => {
		return _startClaudeCodeExternalTail(sessionId, {
			claudeCode,
			emitCcStream,
			broadcastRaw: broadcast as (message: Record<string, unknown>) => void,
			safeString,
			logDebug,
			DEBUG_RTS,
		});
	};

	const startCodexExternalTail = (threadId: string): { stop: () => void } => {
		return _startCodexExternalTail(threadId, {
			emitCxStream,
			broadcastRaw: broadcast as (message: Record<string, unknown>) => void,
			safeString,
			logDebug,
			DEBUG_RTS,
		});
	};

	const syncExternalTailForKey = (key: string | null) => {
		if (!key) return;
		const parsed = parseSessionKey(key);
		if (!parsed) return;
		const { agent, id } = parsed;
		const watchers = sessionWatchers.get(key);
		const watcherCount = watchers?.size ?? 0;

		if (agent === "claude-code") {
			const owner = ccSessionOwners.get(id) ?? null;
			const shouldRun = watcherCount > 0 && !owner;
			if (DEBUG_RTS) {
				logDebug(
					`[RTS] syncExternalTail(CC): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${ccExternalTails.has(id)}`,
				);
			}
			if (shouldRun) {
				if (!ccExternalTails.has(id)) {
					if (DEBUG_RTS) {
						logDebug(`[RTS] Starting Claude Code external tail for session ${id}`);
					}
					ccExternalTails.set(id, startClaudeCodeExternalTail(id));
				}
			} else {
				stopCcExternalTail(id);
			}
			return;
		}

		if (agent === "codex") {
			const owner = cxThreadOwners.get(id) ?? null;
			const shouldRun = watcherCount > 0 && !owner;
			if (DEBUG_RTS) {
				logDebug(
					`[RTS] syncExternalTail(CX): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${cxExternalTails.has(id)}`,
				);
			}
			if (shouldRun) {
				if (!cxExternalTails.has(id)) {
					if (DEBUG_RTS) {
						logDebug(`[RTS] Starting Codex external tail for thread ${id}`);
					}
					cxExternalTails.set(id, startCodexExternalTail(id));
				}
			} else {
				stopCxExternalTail(id);
			}
			return;
		}

		if (agent === "opencode") {
			// OpenCode external tail: poll session messages API when TUI is running externally.
			// When the bridge itself owns the session (sent a prompt via the SDK), the global
			// SSE event stream already delivers events — running the polling tail at the same
			// time would cause every event to be emitted twice (the double-send bug).
			const owner = ocSessionOwners.get(id) ?? null;
			const projectPath = ocSessionProjectPaths.get(id);
			const shouldRun = watcherCount > 0 && !owner && !!opencode && !!projectPath;
			if (DEBUG_RTS) {
				logDebug(
					`[RTS] syncExternalTail(OC): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${ocExternalTails.has(id)}`,
				);
			}
			if (shouldRun) {
				if (!ocExternalTails.has(id)) {
					ocExternalTails.set(id, startOpenCodeExternalTail(id, projectPath));
					if (DEBUG_RTS) {
						logDebug(`[RTS] Starting OpenCode external tail for session ${id}`);
					}
				}
			} else {
				stopOcExternalTail(id);
			}
		}
	};

	const updateSessionWatchers = (ws: ServerWebSocket<unknown>, prevKey: string | null, nextKey: string | null) => {
		if (prevKey) {
			const prevSet = sessionWatchers.get(prevKey);
			if (prevSet) {
				prevSet.delete(ws);
				if (prevSet.size === 0) sessionWatchers.delete(prevKey);
			}
			syncExternalTailForKey(prevKey);
		}
		if (nextKey) {
			let nextSet = sessionWatchers.get(nextKey);
			if (!nextSet) {
				nextSet = new Set();
				sessionWatchers.set(nextKey, nextSet);
			}
			nextSet.add(ws);
			syncExternalTailForKey(nextKey);
		}
	};

	const broadcastToSessionWatchers = (
		agent: AgentType,
		sessionId: string,
		message: ServerMessage,
		owner?: ServerWebSocket<unknown> | null,
	) => {
		const key = makeSessionKey(agent, sessionId);
		if (!key) return;
		const watchers = sessionWatchers.get(key);
		if (!watchers) return;
		for (const ws of watchers) {
			if (owner && ws === owner) continue;
			send(ws, message);
		}
	};

	const emitCcStream = (
		sessionId: string,
		streamMsg: ClaudeCodeStreamMessage,
		owner?: ServerWebSocket<unknown> | null,
	) => {
		if (DEBUG_RTS) {
			const msgType = "type" in streamMsg ? String((streamMsg as Record<string, unknown>).type) : "unknown";
			const resolvedOwner = owner ?? ccSessionOwners.get(sessionId) ?? null;
			logDebug(`[RTS] emitCcStream: session=${sessionId}, msgType=${msgType}, owner=${!!resolvedOwner}`);
		}

		// AskUserQuestion is YOLO-allowlisted in CC — canUseTool never fires.
		// The PreToolUse hook handles the answer path. This synthetic event is
		// a fallback to guarantee the questionnaire sheet shows on the phone.
		// Flutter dedup (pendingQuestion.id check) prevents double-showing.
		const syntheticPermReq = maybeSynthesizeAskUserQuestion(sessionId, streamMsg);
		if (syntheticPermReq) {
			emitCcStream(sessionId, syntheticPermReq, owner);
		}

		// Map to unified runtime_event — this is now the ONLY emission path.
		// Legacy cc_stream was removed in Phase 4 (Flutter only reads runtime_event).
		const runtimeEvent = mapClaudeCodeStreamToRuntimeEvent(streamMsg, {
			backend: "claude-code",
			sessionId,
			cwd: ccSessionCwds.get(sessionId),
		});
		if (!runtimeEvent) return;

		runtimeCoalescer.push(
			{
				type: "runtime_event",
				backend: "claude-code",
				data: runtimeEvent,
			},
			owner,
		);
	};

	const emitCxStream = (threadId: string, streamMsg: CodexStreamMessage, owner?: ServerWebSocket<unknown> | null) => {
		if (DEBUG_RTS) {
			const msgType = "type" in streamMsg ? String((streamMsg as Record<string, unknown>).type) : "unknown";
			const resolvedOwner = owner ?? cxThreadOwners.get(threadId) ?? null;
			logDebug(`[RTS] emitCxStream: thread=${threadId}, msgType=${msgType}, owner=${!!resolvedOwner}`);
		}

		// Map to unified runtime_event — this is now the ONLY emission path.
		// Legacy cx_stream was removed in Phase 4 (Flutter only reads runtime_event).
		const runtimeEvent = mapCodexStreamToRuntimeEvent(streamMsg, {
			backend: "codex",
			threadId,
			cwd: cxThreadCwds.get(threadId),
		});
		if (!runtimeEvent) return;

		runtimeCoalescer.push(
			{
				type: "runtime_event",
				backend: "codex",
				data: runtimeEvent,
			},
			owner,
		);
	};

	// Context for the OC runtime event mapper — tracks reasoning partIDs so that
	// message.part.delta events for reasoning parts are routed as thinking deltas
	// instead of leaking into the visible response text.
	const ocMapperCtx = createOpenCodeMapperContext();

	const extractSessionId = (event: any): string | null => {
		const payload = event?.payload ?? null;
		const properties = payload?.properties ?? null;
		const info = properties?.info ?? null;
		const part = properties?.part ?? null;

		// Try all possible sessionId field locations and formats
		const sessionId =
			// Standard SDK locations
			(typeof info?.sessionID === "string" && info.sessionID) ||
			(typeof info?.sessionId === "string" && info.sessionId) ||
			(typeof properties?.sessionID === "string" && properties.sessionID) ||
			(typeof properties?.sessionId === "string" && properties.sessionId) ||
			(typeof part?.sessionID === "string" && part.sessionID) ||
			(typeof part?.sessionId === "string" && part.sessionId) ||
			// Root level (some events have sessionId at root)
			(typeof event?.sessionID === "string" && event.sessionID) ||
			(typeof event?.sessionId === "string" && event.sessionId) ||
			// Payload level (some events have sessionId directly in payload)
			(typeof payload?.sessionID === "string" && payload.sessionID) ||
			(typeof payload?.sessionId === "string" && payload.sessionId);

		return sessionId ? String(sessionId) : null;
	};

	const getEventType = (event: any): string => {
		const payload = event?.payload ?? null;
		return typeof payload?.type === "string" ? payload.type : "";
	};

	const filterEventForSocket = (ws: ServerWebSocket<unknown>, event: unknown): boolean => {
		const ctx = contexts.get(ws);
		if (!ctx || (!ctx.projectPath && !ctx.sessionId)) {
			if (DEBUG_RTS) {
				logDebug("[RTS] filterEventForSocket: No context, passing through");
			}
			return true;
		}

		const e = event as {
			directory?: string;
			payload?: { type?: string; properties?: Record<string, unknown> };
			sessionID?: string;
			sessionId?: string;
		};
		const safeDecode = (s: string) => {
			try {
				return decodeURIComponent(s);
			} catch {
				return s;
			}
		};

		const normalizeDirectory = (dir: string) => safeDecode(dir).replace(/\/+$/, "");
		const directoryRaw = (typeof e?.directory === "string" ? e.directory : null) ?? "global";
		const directory = directoryRaw === "global" ? "global" : normalizeDirectory(directoryRaw);
		const projectPath =
			ctx.projectPath && ctx.projectPath !== "global" ? normalizeDirectory(ctx.projectPath) : ctx.projectPath;

		if (ctx.projectPath === "global") {
			// Global view = receive ALL events (enables multi-device real-time sync)
			if (DEBUG_RTS) {
				logDebug("[RTS] filterEventForSocket: Global view, passing all events");
			}
			return true;
		}

		if (ctx.sessionId) {
			const sid = extractSessionId(event);
			// If the event is scoped to a session, prioritize session routing over directory routing.
			// This keeps cross-device streaming working even if directory strings differ (e.g. symlinks).
			if (sid) {
				const match = sid === ctx.sessionId;
				if (DEBUG_RTS) {
					const eventType = getEventType(event);
					logDebug(
						`[RTS] filterEventForSocket: Session match check - eventSessionId=${sid}, ctxSessionId=${ctx.sessionId}, match=${match}, eventType=${eventType}`,
					);
				}
				return match;
			}
		}

		if (projectPath && directory !== "global" && directory !== projectPath) {
			if (DEBUG_RTS) {
				logDebug(`[RTS] filterEventForSocket: Directory mismatch - eventDir=${directory}, ctxDir=${projectPath}`);
			}
			return false;
		}

		if (DEBUG_RTS) {
			logDebug("[RTS] filterEventForSocket: Passing through (default)");
		}
		return true;
	};

	const enqueueSdkEvent = (event: unknown) => {
		const runtimeEvent = mapOpenCodeSdkEventToRuntimeEvent(event, ocMapperCtx);

		if (DEBUG_RTS) {
			const eventType = getEventType(event);
			const sid = extractSessionId(event);
			const e = event as {
				directory?: string;
				payload?: { type?: string; properties?: Record<string, unknown> };
				sessionID?: string;
				sessionId?: string;
			};
			const directory = typeof e?.directory === "string" ? e.directory : "global";
			logDebug(
				`[RTS] enqueueSdkEvent: type=${eventType}, sessionId=${sid || "none"}, dir=${directory}, sockets=${sockets.size}`,
			);
		}

		const runtimePayload = runtimeEvent
			? ({
					type: "runtime_event",
					backend: "opencode",
					data: runtimeEvent,
				} as ServerMessage)
			: null;
		if (runtimePayload) {
			recordRuntimeEvent(runtimePayload);
		}

		let deliveredCount = 0;
		for (const ws of sockets) {
			if (!filterEventForSocket(ws, event)) continue;
			deliveredCount++;

			// Phase 4: Only send runtime_event. Legacy sdk_event/sdk_event_batch removed.
			// Flutter only reads runtime_event for OpenCode events.
			if (runtimePayload) {
				send(ws, runtimePayload);
			}
		}

		if (DEBUG_RTS && deliveredCount === 0 && sockets.size > 0) {
			logDebug(`[RTS] enqueueSdkEvent: WARNING - Event not delivered to any socket!`);
		}

		// Keep the hot path lean: forward SDK events first, then do any heavier work.
		queueMicrotask(() => {
			try {
				const e = event as {
					directory?: string;
					payload?: {
						type?: string;
						properties?: Record<string, unknown> & {
							branch?: string;
							sessionID?: string;
							status?: { type?: string };
						};
					};
				};
				const directory = safeString(e?.directory);
				const payloadType = safeString(e?.payload?.type);

				if (payloadType === "vcs.branch.updated" && directory) {
					const branch = safeString(e?.payload?.properties?.branch);
					if (branch) lastGitBranchByProject.set(directory, branch);
				}

				// Release OpenCode session ownership when the session goes idle.
				// This allows the external polling tail to resume for picking up
				// activity from the TUI or other external sources.
				if (payloadType === "session.idle" || payloadType === "session.status") {
					const props = e?.payload?.properties;
					const sid = safeString(props?.sessionID);
					const isIdle = payloadType === "session.idle" || props?.status?.type === "idle";
					if (sid && isIdle && ocSessionOwners.has(sid)) {
						ocSessionOwners.delete(sid);
						syncExternalTailForKey(makeSessionKey("opencode", sid));
						if (DEBUG_RTS) {
							logDebug(`[RTS] OC owner released on idle for session ${sid}, external tail may resume`);
						}
					}
				}
			} catch (err) {
				logError("[server] Failed to process SDK event microtask:", err);
			}
		});
	};

	const HEARTBEAT_INTERVAL_MS = 20000;
	const HEARTBEAT_DEAD_AFTER_MS = 90000;

	// Tick heartbeat: Sent every 30 seconds to all clients.
	// Clients use this to detect stale connections (if no tick in 2x interval = dead).
	// This is separate from ping/pong (which measures RTT).
	const TICK_INTERVAL_MS = 30000;

	const heartbeatTimer = setInterval(() => {
		const now = Date.now();
		for (const ws of sockets) {
			const ctx = contexts.get(ws);
			if (!ctx) continue;

			if (now - ctx.lastPongAt > HEARTBEAT_DEAD_AFTER_MS) {
				try {
					ws.close(4000, "Heartbeat timeout");
				} catch {
					// ignore
				}
				continue;
			}

			// Only keep one in-flight ping per client to make RTT meaningful.
			// But expire stale pings — if the pong was lost (e.g. during a
			// Tailscale DERP-to-direct path migration), we must not block
			// all future pings forever.  30s is generous (normal RTT < 500ms).
			if (ctx.pendingPing) {
				if (now - ctx.pendingPing.sentAt > 30_000) {
					ctx.pendingPing = undefined;
				} else {
					continue;
				}
			}

			const ping = {
				id: `ping_${now}_${Math.floor(Math.random() * 1_000_000)}`,
				sentAt: now,
			};
			ctx.pendingPing = ping;
			send(ws, { type: "ping", data: ping });
		}
	}, HEARTBEAT_INTERVAL_MS);

	// Prune stale event buffers every 5 minutes.  Replay only uses events
	// from the last 60s, so buffers for sessions that haven't streamed in
	// 2 minutes are dead weight.  Also prevents unbounded growth over very
	// long bridge uptimes (months without restart).
	const EVENT_BUFFER_STALE_MS = 120_000;
	const EVENT_BUFFER_PRUNE_INTERVAL_MS = 300_000;
	const pruneEventBuffers = (buffers: Map<string, Array<{ event: any; ts: number }>>) => {
		const now = Date.now();
		for (const [key, buf] of buffers) {
			const newest = buf.length > 0 ? buf[buf.length - 1]!.ts : 0;
			if (now - newest > EVENT_BUFFER_STALE_MS) {
				buffers.delete(key);
			}
		}
	};
	const eventBufferPruneTimer = setInterval(() => {
		pruneEventBuffers(ccEventBuffers);
		pruneEventBuffers(cxEventBuffers);
		pi.pruneIdleInstances();
		sweepBoundedState();
	}, EVENT_BUFFER_PRUNE_INTERVAL_MS);

	// Tick timer: Simple liveness signal to all connected clients.
	// Clients should expect a tick every TICK_INTERVAL_MS. If 2x interval passes
	// without a tick, the client should consider the connection dead and reconnect.
	const tickTimer = setInterval(() => {
		const now = Date.now();
		const tickPayload = JSON.stringify({
			type: "tick",
			timestamp: now,
			interval: TICK_INTERVAL_MS,
		});
		for (const ws of sockets) {
			runtimeSendQueue.sendRaw(ws, tickPayload);
		}

		// Evict stale chat dedup entries (older than 5 minutes)
		const CHAT_DEDUP_TTL_MS = 5 * 60 * 1000;
		for (const [key, tsMs] of recentChatMessageIds) {
			if (now - tsMs > CHAT_DEDUP_TTL_MS) recentChatMessageIds.delete(key);
		}
	}, TICK_INTERVAL_MS);

	// ── Network endpoint watcher ─────────────────────────────────────────
	// Every 10s, re-discover IPs from the interface list (no subprocesses) and
	// broadcast changes to connected phones. The Tailscale CLI is consulted only
	// when the interfaces expose no CGNAT address and they just changed.
	const endpointWatcher = new EndpointWatcher({
		readEndpoints: readLocalEndpoints,
		interfacesFingerprint: interfaceFingerprint,
		resolveTailscaleViaCli: getTailscaleIPViaCli,
		onChange: (snapshot) => {
			logInfo(
				`[Network] Endpoints changed — local=${snapshot.localIP}, tailscale=${snapshot.tailscaleIP}, hotspot=${snapshot.hotspotIP}`,
			);

			broadcast({
				type: "network_endpoints_updated",
				data: {
					localIP: snapshot.localIP,
					tailscaleIP: snapshot.tailscaleIP,
					hotspotIP: snapshot.hotspotIP,
					port: securePort,
				},
			} as ServerMessage);
		},
	});
	endpointWatcher.start();

	const ALLOWED_PROXY_PORTS = buildProxyPortAllowlist();

	const httpDeps: HandleHttpDeps = {
		tlsEnabled,
		webDistDir,
		version,
		allowedProxyPorts: ALLOWED_PROXY_PORTS,
		opencode,
		listFilesDirectly,
		logUser,
		handleCcPermissionHook: (request: Request) => {
			const hookCtx: CcPermissionHookContext = { emitCcStream, logInfo, logDebug, DEBUG_RTS };
			return handleCcPermissionHook(request, hookCtx);
		},
		handleCxPermissionHook: (request: Request) => {
			const hookCtx: CxPermissionHookContext = { broadcast, logInfo, logDebug, DEBUG_RTS };
			return handleCxPermissionHook(request, hookCtx);
		},
	};

	const MAX_WS_MESSAGE_BYTES = Math.max(
		1024 * 1024, // 1MB minimum
		Math.min(Number(process.env.BROSKI_MAX_WS_MESSAGE_MB ?? "15") * 1024 * 1024, 200 * 1024 * 1024), // cap at 200MB
	);

	/** Buffered bytes allowed for one socket before it is shed. Bun's default is 16 MiB. */
	const WS_BACKPRESSURE_LIMIT_BYTES = Math.max(
		128 * 1024,
		Math.min(Number(process.env.BROSKI_WS_BACKPRESSURE_MB ?? "4") * 1024 * 1024, 64 * 1024 * 1024),
	);
	/** Bun's default is 120 s; the app pings every 15 s. */
	const WS_IDLE_TIMEOUT_SECONDS = Math.max(
		30,
		Math.min(Number(process.env.BROSKI_WS_IDLE_TIMEOUT_SECONDS ?? "120"), 600),
	);

	const RATE = {
		perSecond: Math.max(10, Math.min(Number(process.env.BROSKI_RATE_LIMIT_PER_SEC ?? "60"), 5000)),
		burst: Math.max(10, Math.min(Number(process.env.BROSKI_RATE_LIMIT_BURST ?? "150"), 20000)),
		blockMs: Math.max(1000, Math.min(Number(process.env.BROSKI_RATE_LIMIT_BLOCK_MS ?? "10000"), 60_000)),
	};

	const rateLimiters = new Map<
		ServerWebSocket<unknown>,
		{ tokens: number; lastRefill: number; blockedUntil: number }
	>();
	const MAX_CLIENTS = Math.max(1, Math.min(Number(process.env.BROSKI_MAX_CLIENTS ?? "8"), 100));
	const allowedDeviceIdsRaw = (process.env.BROSKI_ALLOWED_DEVICE_IDS ?? "").trim();
	const ALLOWED_DEVICE_IDS = new Set(
		allowedDeviceIdsRaw
			? allowedDeviceIdsRaw
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [],
	);

	const rotateExpiredAuthToken = async (): Promise<void> => {
		const now = Date.now();
		if (now <= authExpiresAt) return;
		// Rotate token on first contact after expiry.
		authState = await createNewAuthState(now, options.tokenTtlDays);
		authToken = authState.token;
		authExpiresAt = authState.expiresAt;
		logUser("[Auth] Token expired; rotated. Run `broski qr` to re-pair (old QR codes invalid).");
		// Drop existing connections; they are no longer authorized.
		for (const ws of sockets) {
			try {
				ws.close(4003, "Auth token rotated");
			} catch {
				// ignore
			}
		}
	};

	if (tlsEnabled) {
		tlsMaterial = await ensureTlsMaterial();
	} else {
		log("[Security] BROSKI_TLS=0 set. Running WITHOUT transport encryption for direct connections.");
	}

	const checkRateLimit = (ws: ServerWebSocket<unknown>): boolean => {
		const now = Date.now();
		const state = rateLimiters.get(ws) ?? {
			tokens: RATE.burst,
			lastRefill: now,
			blockedUntil: 0,
		};
		if (state.blockedUntil && now < state.blockedUntil) {
			rateLimiters.set(ws, state);
			return false;
		}
		const elapsedSec = (now - state.lastRefill) / 1000;
		state.tokens = Math.min(RATE.burst, state.tokens + elapsedSec * RATE.perSecond);
		state.lastRefill = now;
		if (state.tokens < 1) {
			state.blockedUntil = now + RATE.blockMs;
			rateLimiters.set(ws, state);
			return false;
		}
		state.tokens -= 1;
		rateLimiters.set(ws, state);
		return true;
	};

	const websocketConfig = {
		// A phone that stops reading (backgrounded, dead radio, DERP relay gone) must not grow
		// the bridge: past 4 MiB buffered it is closed and the app reconnects + resyncs.
		backpressureLimit: WS_BACKPRESSURE_LIMIT_BYTES,
		closeOnBackpressureLimit: true,
		maxPayloadLength: MAX_WS_MESSAGE_BYTES,
		idleTimeout: WS_IDLE_TIMEOUT_SECONDS,
		// On by default: 4.5× fewer bytes for streamed text and 16× for a session list on the
		// payloads bench/scenarios/ws-deflate.ts measures, for a few ms of CPU per megabyte.
		// `BROSKI_WS_DEFLATE=0` turns it off for a client whose compression is broken.
		perMessageDeflate: process.env.BROSKI_WS_DEFLATE !== "0",
		open(ws: ServerWebSocket<unknown>) {
			const proxy = (ws.data as { kind?: string })?.kind === "proxy";
			if (proxy) {
				const d = ws.data as { port?: string | number; path?: string; search?: string };
				const port = Number(d.port);
				const path = typeof d.path === "string" ? d.path : "/";
				const search = typeof d.search === "string" ? d.search : "";
				const proto = tlsEnabled ? "wss" : "ws";
				const upstreamUrl = `${proto}://127.0.0.1:${port}${path}${search}`;
				try {
					const upstream = new WebSocket(upstreamUrl);
					(ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream = upstream;
					upstream.onmessage = (evt) => {
						const frame = typeof evt.data === "string" ? evt.data : new Uint8Array(evt.data as ArrayBuffer);
						if (runtimeSendQueue.sendRaw(ws, frame) === "dropped") {
							try {
								upstream.close();
							} catch {
								// ignore
							}
						}
					};
					upstream.onclose = () => {
						try {
							ws.close(1000, "Upstream closed");
						} catch {
							// ignore
						}
					};
					upstream.onerror = () => {
						try {
							ws.close(1011, "Upstream error");
						} catch {
							// ignore
						}
					};
				} catch {
					try {
						ws.close(1011, "Proxy init failed");
					} catch {
						// ignore
					}
				}
				return;
			}
			sockets.add(ws);
			rateLimiters.set(ws, {
				tokens: RATE.burst,
				lastRefill: Date.now(),
				blockedUntil: 0,
			});
			const baseCtx: ConnectionContext = {
				lastPongAt: Date.now(),
				lastRttMs: 0,
				connectionType: "unknown",
				connectedAt: Date.now(),
			};
			contexts.set(ws, baseCtx);
			logUser(`Client connected (${sockets.size} active)`);
			logInfo(`[WS] Client CONNECTED (${sockets.size} total)`);
			void sendStatus(ws);
		},
		close(ws: ServerWebSocket<unknown>, code?: number, reason?: string) {
			logUser(`Client disconnected`);
			logInfo(`[WS] Client DISCONNECTED - code=${code}, reason=${reason}`);
			const proxy = (ws.data as { kind?: string })?.kind === "proxy";
			if (proxy) {
				const upstream = (ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream;
				(ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream = undefined;
				try {
					upstream?.close();
				} catch {
					// ignore
				}
				return;
			}
			const ctx = contexts.get(ws);
			logInfo(`[WS] Disconnect context - deviceId=${ctx?.deviceId}`);
			const disconnectedDeviceId = ctx?.deviceId;
			const disconnectedDeviceName = ctx?.deviceName;
			const prevKey = makeSessionKey(ctx?.viewAgent, ctx?.sessionId);
			updateSessionWatchers(ws, prevKey, null);
			piDurable.detach(piDurableSockets.for(ws));
			cxRouting.detachCxFsWatches(ws, codexClient);

			// If this socket owned any CC/Codex/OpenCode sessions, release ownership so watchers
			// can fall back to external tailing (or another owner) correctly.
			const releasedKeys: Array<{ agent: AgentType; id: string }> = [];
			for (const [sid, owner] of ccSessionOwners.entries()) {
				if (owner === ws) {
					ccSessionOwners.delete(sid);
					releasedKeys.push({ agent: "claude-code", id: sid });
				}
			}
			for (const [tid, owner] of cxThreadOwners.entries()) {
				if (owner === ws) {
					cxThreadOwners.delete(tid);
					releasedKeys.push({ agent: "codex", id: tid });
				}
			}
			for (const [sid, owner] of ocSessionOwners.entries()) {
				if (owner === ws) {
					ocSessionOwners.delete(sid);
					releasedKeys.push({ agent: "opencode", id: sid });
				}
			}
			for (const k of releasedKeys) {
				syncExternalTailForKey(makeSessionKey(k.agent, k.id));
			}

			sockets.delete(ws);
			contexts.delete(ws);
			rateLimiters.delete(ws);
			runtimeSendQueue.disposeSocket(ws);

			// Pi watchers are registered per socket; a socket that goes away without another
			// set_view would otherwise keep its external tail polling for the session forever.
			for (const orphanedSessionId of piFeatures.prunePiWatchers((sock) => sockets.has(sock))) {
				piFeatures.stopPiExternalTail(orphanedSessionId);
			}

			// Remove client from active PTY subscriptions.
			ptyRuntime.onClientDisconnected(ws);
			log(`Client disconnected (${sockets.size} total)`);

			if (disconnectedDeviceId) {
				broadcast({
					type: "device_disconnected",
					data: {
						deviceId: disconnectedDeviceId,
						deviceName: disconnectedDeviceName,
					},
				});
			}
		},
		message(ws: ServerWebSocket<unknown>, raw: string | Uint8Array) {
			const proxy = (ws.data as { kind?: string })?.kind === "proxy";
			if (proxy) {
				const upstream = (ws as unknown as { __proxyUpstream?: WebSocket }).__proxyUpstream;
				try {
					if (upstream && upstream.readyState === WebSocket.OPEN) {
						upstream.send(typeof raw === "string" ? raw : new Uint8Array(raw));
					}
				} catch {
					// ignore
				}
				return;
			}
			const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
			if (bytes > MAX_WS_MESSAGE_BYTES) {
				try {
					ws.close(1009, "Message too large");
				} catch {
					// ignore
				}
				return;
			}
			if (!checkRateLimit(ws)) {
				// Best-effort: notify, but don't amplify further under load.
				try {
					send(ws, { type: "error", message: "RATE_LIMITED" });
				} catch {
					// ignore
				}
				return;
			}
			void handleMessage(ws, raw);
		},
		drain(ws: ServerWebSocket<unknown>) {
			runtimeSendQueue.onDrain(ws);
		},
	} satisfies Bun.WebSocketHandler<unknown>;

	const fetchHandlerDeps: FetchHandlerDeps = {
		httpDeps,
		safeString,
		allowTokenInUrl,
		validateAuthToken,
		getAuthToken: () => authToken,
		getAuthExpiresAt: () => authExpiresAt,
		rotateExpiredAuthToken,
		sockets,
		maxClients: MAX_CLIENTS,
		tlsEnabled,
		isLoopbackAddress,
		isTailscaleAddress,
		allowedProxyPorts: ALLOWED_PROXY_PORTS,
		log,
		logUser,
	};

	const makeFetch = (serverLabel: string) => createFetchHandler(serverLabel, fetchHandlerDeps);

	let secureServer: ReturnType<typeof Bun.serve>;
	try {
		secureServer = Bun.serve({
			// If TLS is disabled, only bind to loopback to avoid exposing plaintext traffic on LAN/WiFi.
			...(tlsMaterial ? {} : { hostname: "127.0.0.1" }),
			port: options.port,
			...(tlsMaterial
				? {
						tls: {
							key: Bun.file(tlsMaterial.keyPath),
							cert: Bun.file(tlsMaterial.certPath),
						},
					}
				: {}),
			fetch: makeFetch("secure"),
			websocket: websocketConfig,
		});
	} catch (error) {
		releaseFailedBindResources({
			intervals: [heartbeatTimer, tickTimer, eventBufferPruneTimer],
			stopEndpointWatcher: () => endpointWatcher.stop(),
			closeFsWatchers: () => ccFsWatchers.closeAll(),
			unregisterSweepables: unregisterBoundedState,
		});
		throw error;
	}
	const securePort = secureServer.port ?? options.port;

	// Install CC permission hook in ~/.claude/settings.json (non-blocking)
	void installCcHook(securePort, authToken, logInfo).catch((err) => {
		logInfo(`[CC Hook] Install failed (non-fatal): ${toErrorMessage(err)}`);
	});

	// Install CX permission hook in ~/.codex/hooks.json (non-blocking)
	void installCxHook(securePort, authToken, logInfo).catch((err) => {
		logInfo(`[CX Hook] Install failed (non-fatal): ${toErrorMessage(err)}`);
	});

	let loopbackServer: ReturnType<typeof Bun.serve> | null = null;
	let loopbackPort: number | null = null;
	if (options.enableLoopbackInsecureServer) {
		loopbackServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: makeFetch("loopback"),
			websocket: websocketConfig,
		});
		loopbackPort = loopbackServer.port ?? null;
		if (loopbackPort) {
			log(`[Funnel] Loopback backend listening on 127.0.0.1:${loopbackPort}`);
		}
	}

	async function sendStatus(ws: ServerWebSocket<unknown>): Promise<void> {
		const ctx = contexts.get(ws);
		const activeAgent: AgentType = ctx?.viewAgent ?? currentAgent;
		const backends = await getBackendsStatus();
		send(ws, {
			type: "status",
			data: {
				opencodeRunning: backends.opencode.available,
				activeAgent,
				backends,
			},
		});
	}

	const getCurrentAgent = (): AgentType => currentAgent;
	const setCurrentAgent = (agent: AgentType): void => {
		currentAgent = agent;
	};
	const requireOpenCodeOrNull = (): OpenCodeConnector | null => {
		try {
			return requireOpenCode();
		} catch {
			return null;
		}
	};

	const serverDeps: ServerDeps = {
		contexts,
		sockets,
		send,
		sendStatus,
		broadcast,
		broadcastToSessionWatchers,
		log,
		logUser,
		logInfo,
		logDebug,
		logError,
		DEBUG_RTS,
		DEBUG_CX_GLOBAL,
		BRIDGE_PROTOCOL_VERSION,
		ALLOWED_DEVICE_IDS,
		getDeviceInfo,
		getAllDevices,
		findSocketByDeviceId,
		getClaudeCodeChildren: async () => {
			const { listSubagents, getSubagentMessages } = await import("@anthropic-ai/claude-agent-sdk");
			return {
				listSubagents: (sessionId: string, cwd?: string) => listSubagents(sessionId, { dir: cwd }),
				getSubagentMessages: (sessionId: string, agentId: string, cwd?: string) =>
					getSubagentMessages(sessionId, agentId, { dir: cwd }),
			};
		},
		claudeCode,
		opencode,
		codexFs,
		ensureCodexClient,
		get codexClient() {
			return codexClient;
		},
		requireOpenCode,
		requireOpenCodeOrNull,
		checkCodexAvailable,
		getBackendsStatus,
		restartOpenCode: options.restartOpenCode,
		safeString,
		getSecurePath,
		isSafeClaudeCommandName,
		resolveClaudeCommandFilePath,
		readFileDirectly,
		readFileBinaryDirectly,
		listFilesDirectly,
		fileSearch,
		recentChatMessageIds,
		ccSessionOwners,
		ccSessionCwds,
		ccEventBuffers,
		ccPermissionWaiters,
		ccElicitationWaiters,
		cxApprovalWaiters,
		cxActiveTurns,
		cxThreadOwners,
		cxThreadCwds,
		cxThreadNames,
		cxThreadCache,
		get cxProjectCache() {
			return cxProjectCache;
		},
		setProjectCache: (cache) => {
			cxProjectCache = cache;
		},
		cxSearchSessions,
		CODEX_PROJECT_CACHE_TTL_MS,
		CODEX_THREAD_CACHE_TTL_MS,
		invalidateCodexCaches,
		ensureUndoStack,
		applyCodexUndo,
		mapCodexThread,
		mapCodexThreadToRuntimeSession,
		mapClaudeCodeSessionToRuntimeSession,
		mapClaudeCodeModelToSummary,
		ocSessionOwners,
		ocSessionProjectPaths,
		sessionWatchers,
		updateSessionWatchers,
		makeSessionKey,
		syncExternalTailForKey,
		ensureClaudeWatchDir,
		get currentAgent() {
			return currentAgent;
		},
		getCurrentAgent,
		setCurrentAgent,
		buildClaudeCodeRuntimeState,
		buildCodexRuntimeState,
		mapOpenCodeStatusToRuntimeState,
		listPiActiveSessionSnapshots,
		buildPiActiveRuntimeStateMessages,
		findPiActiveRuntimeStateMessage,
		replayRuntimeEventsSince: replayRuntimeEventsForSocket,
		emitCcStream,
		emitCxStream,
		enqueueSdkEvent,
		PERMISSION_TIMEOUT_MS,
		ptyRuntime,
		piDurableSockets,
	};

	const messageRegistry = createMessageRegistry(serverDeps);

	const processSingleMessage = async (
		ws: ServerWebSocket<unknown>,
		message: ClientMessage & { requestId?: string },
		reply: (response: ServerMessage) => void,
	) => {
		const shapeError = validateMessageShape(message as unknown as Record<string, unknown>);
		if (shapeError) {
			reply(invalidPayloadError(shapeError));
			return;
		}

		// Security: never trust client-supplied filesystem roots.
		// Many message types accept `cwd` / `projectPath` and downstream SDKs
		// (Codex/OpenCode/Claude Code) will happily use whatever we pass.
		// We canonicalize to a real path and enforce the allowed-base allowlist.
		const rawCwd = (message as unknown as Record<string, unknown>).cwd;
		if (typeof rawCwd === "string" && rawCwd.trim()) {
			const secureCwd = await getSecurePath(rawCwd.trim());
			if (!secureCwd) {
				reply({
					type: "error",
					message: "Access denied",
					requestId: message.requestId,
				});
				return;
			}
			(message as unknown as Record<string, unknown>).cwd = secureCwd;
		}

		const rawProjectPath = (message as unknown as Record<string, unknown>).projectPath;
		if (typeof rawProjectPath === "string" && rawProjectPath.trim()) {
			const secureProjectPath = await getSecurePath(rawProjectPath.trim());
			if (!secureProjectPath) {
				reply({
					type: "error",
					message: "Access denied",
					requestId: message.requestId,
				});
				return;
			}
			(message as unknown as Record<string, unknown>).projectPath = secureProjectPath;
		}

		// pi_get_subagent_invocation carries a raw `parentSessionPath` pointing
		// at a JSONL file under the Pi sessions directory. Canonicalize it the
		// same way as cwd/projectPath to prevent path traversal attacks.
		const rawParentSessionPath = (message as unknown as Record<string, unknown>).parentSessionPath;
		if (typeof rawParentSessionPath === "string" && rawParentSessionPath.trim()) {
			const secureParent = await getSecurePath(rawParentSessionPath.trim());
			if (!secureParent) {
				reply({
					type: "error",
					message: "Access denied",
					requestId: message.requestId,
				});
				return;
			}
			(message as unknown as Record<string, unknown>).parentSessionPath = secureParent;
		}

		await messageRegistry.dispatch(message, { ...serverDeps, ws, reply });
	};

	const handleMessage = async (ws: ServerWebSocket<unknown>, raw: string | Uint8Array) => {
		const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

		let message: ClientMessage & { requestId?: string };
		try {
			const parsed = JSON.parse(text);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				send(ws, { type: "error", message: "Invalid JSON payload" });
				return;
			}
			if (hasPrototypePoisonKeys(parsed)) {
				send(ws, { type: "error", message: "Invalid JSON payload" });
				return;
			}
			message = parsed as ClientMessage & { requestId?: string };
		} catch {
			send(ws, { type: "error", message: "Invalid JSON payload" });
			return;
		}

		if (typeof message.type !== "string" || message.type.length > 64) {
			send(ws, { type: "error", message: "Invalid message type" });
			return;
		}

		const requestId = message.requestId;
		const reply = (response: ServerMessage) => {
			send(ws, requestId ? ({ ...response, requestId } as ServerMessage) : response);
		};

		try {
			if (message.type === "batch") {
				const batchedMessages = message.messages as Array<ClientMessage & { requestId?: string }>;
				if (!Array.isArray(batchedMessages)) {
					reply({
						type: "error",
						message: "Invalid batch: messages must be an array",
					});
					return;
				}

				if (batchedMessages.length > MAX_BATCH_SIZE) {
					reply({
						type: "error",
						message: `Batch too large: ${batchedMessages.length} messages (max ${MAX_BATCH_SIZE})`,
					});
					return;
				}

				for (const batchedMsg of batchedMessages) {
					const batchReply = (response: ServerMessage) => {
						send(
							ws,
							batchedMsg.requestId ? ({ ...response, requestId: batchedMsg.requestId } as ServerMessage) : response,
						);
					};

					try {
						await processSingleMessage(ws, batchedMsg, batchReply);
					} catch (batchError) {
						batchReply({
							type: "error",
							message: toPublicErrorMessage(batchError),
						});
					}
				}
			} else {
				await processSingleMessage(ws, message, reply);
			}
		} catch (error) {
			reply({ type: "error", message: toPublicErrorMessage(error) });
		}
	};

	return {
		broadcast,
		enqueueSdkEvent,
		stop: (force = true) => {
			clearInterval(heartbeatTimer);
			clearInterval(tickTimer);
			endpointWatcher.stop();
			clearInterval(eventBufferPruneTimer);
			for (const waiter of ccPermissionWaiters.values()) {
				clearTimeout(waiter.timer);
				waiter.resolve({ response: "reject" });
			}
			ccPermissionWaiters.clear();
			for (const waiter of ccElicitationWaiters.values()) {
				clearTimeout(waiter.timer);
				waiter.resolve({ action: "cancel" });
			}
			ccElicitationWaiters.clear();
			for (const waiter of cxApprovalWaiters.values()) {
				clearTimeout(waiter.timer);
				waiter.resolve({ response: "reject" });
			}
			cxApprovalWaiters.clear();
			for (const unregister of unregisterBoundedState) unregister();

			return stopBridgeResources(
				{
					externalTails: [ccExternalTails, cxExternalTails, ocExternalTails],
					eventBuffers: [ccEventBuffers, cxEventBuffers],
					closeFsWatchers: () => ccFsWatchers.closeAll(),
					stopPtyRuntime: () => ptyRuntime.stop(),
					uninstallHooks: [() => uninstallCcHook(logInfo), () => uninstallCxHook(logInfo)],
					stopCodexAppServer: () => stopCodexAppServer(),
					disposeBackends: [
						() => pi.disposeAll(),
						() => piFeatures.stopAllPiExternalTails(),
						() => piDurable.shutdown(),
					],
					stopServers: () => {
						secureServer.stop(force);
						loopbackServer?.stop(force);
					},
				},
				{ timeoutMs: DEFAULT_TEARDOWN_TIMEOUT_MS, log: logError },
			);
		},
		connections: () => sockets.size,
		port: () => securePort,
		funnelBackendPort: () => loopbackPort,
		authToken: () => authToken,
		tls: () => ({
			enabled: !!tlsMaterial,
			certSha256: tlsMaterial?.certSha256 ?? null,
		}),
	};
}
