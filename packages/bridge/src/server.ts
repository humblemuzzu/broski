import type { ServerWebSocket } from "bun";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { OpenCodeConnector } from "./connectors/opencode";
import type {
	AgentStatusInfo,
	AgentType,
	ClaudeCodeStreamMessage,
	ClientMessage,
	CodexStreamMessage,
	CodexThread,
	DeviceInfo,
	FileAttachment,
	PermissionResponse,
	ServerMessage,
	SessionStatusInfo,
} from "./types";
import * as claudeCode from "./connectors/claude-code";
import * as codexFs from "./connectors/codex-fs";
import * as fileSearch from "./file-search";
import {
	listFilesDirectly as _listFilesDirectly,
	readFileDirectly as _readFileDirectly,
	readFileBinaryDirectly as _readFileBinaryDirectly,
} from "./file-ops";
import { CodexAppServerClient, checkCodexAvailable } from "./connectors/codex";
import * as pi from "./connectors/pi";
import { buildCodexApprovalDecision } from "./handlers/codex/approval-decision";
import { mapCodexThreadFromSdk } from "./handlers/codex/map-thread";
import { handleCodexRuntimeNotification } from "./handlers/codex/runtime-notifications";
import { extractCodexErrorDetails } from "./handlers/codex/cx_error_extract";
import { handleGitFeature } from "./handlers/git";
import * as ocRouting from "./handlers/oc_routing";
import * as piFeatures from "./handlers/pi_features";
import * as ccElicitation from "./handlers/cc_elicitation";
import type { ClaudeElicitationReply } from "./handlers/cc_elicitation";
import { handleAuth } from "./handlers/auth";
import { handleCcChat } from "./handlers/cc_chat";
import * as ccRouting from "./handlers/cc_routing";
import * as devicesHandler from "./handlers/devices";
import * as sessionViewHandler from "./handlers/session_view";
import * as cxRouting from "./handlers/cx_routing";
import * as miscHandler from "./handlers/misc";
import { mapClaudeCodeStreamToRuntimeEvent } from "./runtime/claude-code-runtime-event-mapper";
import {
	buildClaudeCodeRuntimeState,
	mapClaudeCodeModelToSummary,
	mapClaudeCodeSessionToRuntimeSession,
} from "./runtime/claude-code-runtime-read-models";
import { mapCodexStreamToRuntimeEvent } from "./runtime/codex-runtime-event-mapper";
import {
	buildCodexRuntimeState,
	mapCodexModelToSummary,
	mapCodexThreadToRuntimeSession,
} from "./runtime/codex-runtime-read-models";
import {
	mapOpenCodeSdkEventToRuntimeEvent,
	createOpenCodeMapperContext,
} from "./runtime/opencode-runtime-event-mapper";
import { mapOpenCodeStatusToRuntimeState } from "./runtime/opencode-runtime-read-models";
import {
	buildPiActiveRuntimeStateMessages,
	findPiActiveRuntimeStateMessage,
	listPiActiveSessionSnapshots,
} from "./runtime/pi-runtime-bootstrap";
import { PtyManager } from "./pty/manager";
import { PtyRuntime } from "./pty/runtime";
import { ensureTlsMaterial, isTlsEnabledByEnv, type TlsMaterial } from "./tls";
import { isCompiledBinary } from "./platform";
import { loadLocalLicenseState, refreshLocalLicenseFromCloud, type LocalLicenseState } from "./license";
import type { BridgeLogger } from "./logging/logger";
import { startClaudeCodeExternalTail as _startClaudeCodeExternalTail } from "./cc-external-tail";
import { resolveCodexExternalSessionFile as _resolveCodexExternalSessionFile, startCodexExternalTail as _startCodexExternalTail } from "./cx-external-tail";
import { startOpenCodeExternalTail as _startOpenCodeExternalTail } from "./oc-external-tail";
import { createFetchHandler, type HandleHttpDeps, type FetchHandlerDeps } from "./http-handler";
import { toErrorMessage, toPublicErrorMessage, buildProxyPortAllowlist } from "./http-utils";
// Extracted modules
import {
	type AuthTokenState,
	createNewAuthState,
	loadOrCreateAuthState,
	loadOrCreateAuthToken,
	validateAuthToken,
} from "./auth-token";
import {
	isLoopbackAddress,
	isTailscaleAddress,
	hasPrototypePoisonKeys,
	isSafeClaudeCommandName,
	resolveClaudeCommandFilePath,
	getSecurePath,
} from "./security";

// Re-export for backward compatibility (external consumers import from './server')
export { loadOrCreateAuthState, loadOrCreateAuthToken, type AuthTokenState } from "./auth-token";

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

function isTruthyEnv(value: string | undefined, fallback: boolean): boolean {
	if (value == null) return fallback;
	const v = value.trim().toLowerCase();
	if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
	if (v === "0" || v === "false" || v === "no" || v === "off") return false;
	return fallback;
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
	cloud?: {
		convexHttpBaseUrl?: string;
		requireEntitlement?: boolean;
		entitlementCacheTtlMs?: number;
		entitlementRecheckMs?: number;
		offlineGraceHours?: number;
	};
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
	stop: (force?: boolean) => void;
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
	// Cloud-authenticated session (Convex) for licensing/entitlements.
	cloudAuthed?: boolean;
	cloudAppUserId?: string;
	cloudEntitled?: boolean;
	cloudStatus?: string;
	cloudCheckedAt?: number;
	cloudSessionToken?: string;
	cloudSessionTokenHash?: string;
	licenseExpSec?: number;
};

type ClientQueue = {
	queue: unknown[];
	timer: Timer | null;
};

const BATCH_THRESHOLDS = {
	local: { low: 16, high: 8, burst: 4 },
	tailscale: { low: 32, high: 16, burst: 8 },
	highLatency: { low: 50, high: 25, burst: 12 },
};

const MESSAGE_PRIORITIES: Record<string, "immediate" | "high" | "normal" | "low"> = {
	// Immediate — user-blocking interactions
	"permission.updated": "immediate",
	"permission.asked": "immediate",
	"permission.replied": "immediate",
	"question.asked": "immediate",
	"question.replied": "immediate",
	"question.rejected": "immediate",
	"session.error": "immediate",
	"message.part.delta": "immediate",
	// High — visible state changes
	"session.idle": "high",
	"session.status": "high",
	"message.part.updated": "high",
	"message.part.removed": "high",
	"message.removed": "high",
	"command.executed": "high",
	// Normal — list/state updates
	"message.updated": "normal",
	"session.diff": "normal",
	"todo.updated": "normal",
	"session.compacted": "normal",
	"session.created": "normal",
	"session.deleted": "normal",
	"pty.created": "normal",
	"pty.updated": "normal",
	"pty.exited": "normal",
	"pty.deleted": "normal",
	"worktree.ready": "normal",
	"worktree.failed": "normal",
	"workspace.ready": "normal",
	"workspace.failed": "normal",
	"mcp.tools.changed": "normal",
	"file.edited": "normal",
	"project.updated": "normal",
	"vcs.branch.updated": "normal",
	// Low — background / infrequent
	"session.updated": "low",
	"file.watcher.updated": "low",
	"lsp.updated": "low",
	"installation.updated": "low",
	"installation.update-available": "low",
	"mcp.browser.open.failed": "low",
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
	const clientQueues = new Map<ServerWebSocket<unknown>, ClientQueue>();
	const cloudAuthTimers = new Map<ServerWebSocket<unknown>, Timer>();
	let localLicense: LocalLicenseState | null = null;
	// In compiled binaries, ignore config/env overrides for security-critical timings.
	// Users must not be able to extend cache or grace periods to bypass license checks.
	const compiled = isCompiledBinary();
	const ENTITLEMENT_CACHE_TTL_MS = compiled
		? 30_000 // 30 seconds — hardcoded for production
		: Math.max(
				5_000,
				Math.min(
					Number(options.cloud?.entitlementCacheTtlMs ?? process.env.BROSKI_ENTITLEMENT_CACHE_TTL_MS ?? "30000"),
					10 * 60 * 1000,
				),
			);
	const ENTITLEMENT_RECHECK_MS = compiled
		? 30 * 60_000 // 30 minutes — hardcoded for production
		: Math.max(
				60_000,
				Math.min(
					Number(
						options.cloud?.entitlementRecheckMs ?? process.env.BROSKI_ENTITLEMENT_RECHECK_MS ?? String(30 * 60_000),
					),
					24 * 60 * 60 * 1000,
				),
			);
	const OFFLINE_GRACE_MS = compiled
		? 72 * 60 * 60 * 1000 // 72 hours — hardcoded for production
		: Math.max(
				0,
				Math.min(
					Number(options.cloud?.offlineGraceHours ?? process.env.BROSKI_LICENSE_OFFLINE_GRACE_HOURS ?? "72") *
						60 *
						60 *
						1000,
					7 * 24 * 60 * 60 * 1000,
				),
			);
	const entitlementCache = new Map<
		string,
		{ checkedAt: number; appUserId: string; entitled: boolean; status?: string }
	>();

	// Web dashboard dist directory (served by bridge HTTP when present).
	const webDistDir = (() => {
		const fromEnv = safeString(process.env.BROSKI_WEB_DIST).trim();
		if (fromEnv) return resolve(fromEnv);
		// repo layout: packages/bridge/src -> ../../web-app/dist
		return resolve(import.meta.dir, "..", "..", "web-app", "dist");
	})();

	try {
		localLicense = await loadLocalLicenseState();
		if (localLicense?.entitled) {
			const expInSec = Math.max(0, localLicense.exp - Math.floor(Date.now() / 1000));
			log(`[License] Local license loaded (expires in ${Math.floor(expInSec / 60)} min)`);
		}
	} catch {
		// ignore
	}

	const clearCloudAuthTimer = (ws: ServerWebSocket<unknown>) => {
		const t = cloudAuthTimers.get(ws);
		if (t) clearTimeout(t);
		cloudAuthTimers.delete(ws);
	};

	const scheduleCloudAuthDeadline = (ws: ServerWebSocket<unknown>) => {
		clearCloudAuthTimer(ws);
		if (!requireEntitlement) return;
		const t = setTimeout(() => {
			const ctx = contexts.get(ws);
			if (ctx?.cloudAuthed) return;
			try {
				send(ws, {
					type: "error",
					message: "CLOUD_AUTH_REQUIRED",
					code: "CLOUD_AUTH_REQUIRED",
				});
			} catch {
				// ignore
			}
			try {
				ws.close(4401, "Cloud auth required");
			} catch {
				// ignore
			}
		}, 10_000);
		cloudAuthTimers.set(ws, t);
	};

	const refreshCloudEntitlement = async (
		ws: ServerWebSocket<unknown>,
		ctx: ConnectionContext,
		reason: string,
	): Promise<void> => {
		if (!requireEntitlement) return;
		if (!convexHttpBaseUrl) return;
		const sessionToken = ctx.cloudSessionToken;
		if (!sessionToken) return;

		const now = Date.now();
		if (ctx.cloudCheckedAt && now - ctx.cloudCheckedAt < ENTITLEMENT_RECHECK_MS) return;

		const tokenHash = createHash("sha256").update(sessionToken, "utf8").digest("hex");
		const cached = entitlementCache.get(tokenHash);
		// Only use cache if entitled=true. If cache says NOT entitled, always do fresh check
		// (subscription might have just renewed, especially in sandbox where they renew every 5 min)
		if (cached && cached.entitled && now - cached.checkedAt <= ENTITLEMENT_CACHE_TTL_MS) {
			contexts.set(ws, {
				...ctx,
				cloudAuthed: true,
				cloudAppUserId: cached.appUserId,
				cloudEntitled: cached.entitled,
				cloudStatus: cached.status,
				cloudCheckedAt: cached.checkedAt,
				cloudSessionTokenHash: tokenHash,
				licenseExpSec: localLicense?.sessionTokenHash === tokenHash ? localLicense.exp : undefined,
			});
			return;
		}

		try {
			const refreshed = await refreshLocalLicenseFromCloud({
				convexHttpBaseUrl,
				sessionToken,
			});

			if (!refreshed.ok) {
				if (refreshed.status === 401) {
					try {
						ws.close(4401, "Invalid session");
					} catch {
						// ignore
					}
					return;
				}

				// Keep working if we have a valid local license for this session and it's not expired.
				const nowSec = Math.floor(Date.now() / 1000);
				if (localLicense?.entitled && localLicense.sessionTokenHash === tokenHash && nowSec <= localLicense.exp) {
					contexts.set(ws, {
						...ctx,
						cloudAuthed: true,
						cloudAppUserId: localLicense.appUserId,
						cloudEntitled: true,
						cloudStatus: localLicense.status,
						cloudCheckedAt: now,
						cloudSessionTokenHash: tokenHash,
						licenseExpSec: localLicense.exp,
					});
					log(`[CloudAuth] Refresh failed (${reason}); using valid local license`);
					return;
				}

				if (cached && cached.entitled && now - cached.checkedAt <= OFFLINE_GRACE_MS) {
					contexts.set(ws, {
						...ctx,
						cloudAuthed: true,
						cloudAppUserId: cached.appUserId,
						cloudEntitled: cached.entitled,
						cloudStatus: cached.status,
						cloudCheckedAt: cached.checkedAt,
						cloudSessionTokenHash: tokenHash,
						licenseExpSec: localLicense?.sessionTokenHash === tokenHash ? localLicense.exp : undefined,
					});
					log(`[CloudAuth] Offline grace applied during refresh (${reason})`);
					return;
				}

				if (refreshed.status === 403) {
					try {
						ws.close(4403, "License required");
					} catch {
						// ignore
					}
					return;
				}

				log(`[CloudAuth] Refresh failed (${reason}): ${refreshed.code} ${refreshed.message}`);
				return;
			}

			if (refreshed.state.entitled) localLicense = refreshed.state;
			const record = {
				checkedAt: now,
				appUserId: refreshed.state.appUserId,
				entitled: refreshed.state.entitled,
				...(refreshed.state.status ? { status: refreshed.state.status } : {}),
			};
			entitlementCache.set(tokenHash, record);
			contexts.set(ws, {
				...ctx,
				cloudAuthed: true,
				cloudAppUserId: refreshed.state.appUserId,
				cloudEntitled: refreshed.state.entitled,
				cloudStatus: refreshed.state.status,
				cloudCheckedAt: record.checkedAt,
				cloudSessionTokenHash: tokenHash,
				licenseExpSec: refreshed.state.exp,
			});
			if (!refreshed.state.entitled) {
				try {
					ws.close(4403, "License required");
				} catch {
					// ignore
				}
			}
		} catch (error) {
			const nowSec = Math.floor(Date.now() / 1000);
			if (localLicense?.entitled && localLicense.sessionTokenHash === tokenHash && nowSec <= localLicense.exp) {
				contexts.set(ws, {
					...ctx,
					cloudAuthed: true,
					cloudAppUserId: localLicense.appUserId,
					cloudEntitled: true,
					cloudStatus: localLicense.status,
					cloudCheckedAt: now,
					cloudSessionTokenHash: tokenHash,
					licenseExpSec: localLicense.exp,
				});
				log(`[CloudAuth] Cloud unreachable during refresh (${reason}); using valid local license`);
				return;
			}

			if (cached && cached.entitled && now - cached.checkedAt <= OFFLINE_GRACE_MS) {
				contexts.set(ws, {
					...ctx,
					cloudAuthed: true,
					cloudAppUserId: cached.appUserId,
					cloudEntitled: cached.entitled,
					cloudStatus: cached.status,
					cloudCheckedAt: cached.checkedAt,
					cloudSessionTokenHash: tokenHash,
					licenseExpSec: localLicense?.sessionTokenHash === tokenHash ? localLicense.exp : undefined,
				});
				log(`[CloudAuth] Offline grace applied during refresh (${reason})`);
				return;
			}
			log(`[CloudAuth] Refresh failed (${reason}): ${toErrorMessage(error)}`);
		}
	};
	// Permission/approval timeout: 10 minutes.
	// Users may background the app for extended periods; auto-rejecting after 2 minutes
	// kills long-running sessions that need approval. 10 min gives enough time for
	// app background → resume → approve flow, even on slow networks.
	const PERMISSION_TIMEOUT_MS = 600_000; // 10 minutes

	// Recent event buffer: keeps last N stream events per session for instant replay
	// on reconnect. When the app disconnects and reconnects, the external tail syncs
	// from disk, but there's a gap window. This buffer bridges that gap.
	const SESSION_EVENT_BUFFER_SIZE = 100;
	const ccEventBuffers = new Map<string, Array<{ event: any; ts: number }>>();
	const cxEventBuffers = new Map<string, Array<{ event: any; ts: number }>>();

	// Dedupe chat prompts (prevents resend storms on flaky networks).
	const recentChatMessageIds = new Map<string, number>(); // key: `${sessionId}:${messageId}` -> tsMs
	const ptyManager = new PtyManager(opencode);
	const sessionWatchers = new Map<string, Set<ServerWebSocket<unknown>>>();
	const ccExternalTails = new Map<string, { stop: () => void }>(); // sessionId -> tailer
	const cxExternalTails = new Map<string, { stop: () => void }>(); // threadId -> tailer
	const ocExternalTails = new Map<string, { stop: () => void }>(); // sessionId -> tailer (OpenCode)
	const ocSessionProjectPaths = new Map<string, string>(); // sessionId -> projectPath (for external tail)
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
	const ccSessionCwds = new Map<string, string>();
	const cxThreadOwners = new Map<string, ServerWebSocket<unknown>>();
	const ocSessionOwners = new Map<string, ServerWebSocket<unknown>>();
	const cxActiveTurns = new Map<string, string>();
	const cxItemCache = new Map<string, any>(); // key: `${threadId}:${turnId}:${itemId}` -> item
	const cxThreadCwds = new Map<string, string>(); // threadId -> absolute cwd
	const cxThreadNames = new Map<string, string>(); // threadId -> custom name (from thread/name/updated)
	const cxFileChangeSnapshots = new Map<string, string>(); // `${threadId}:${turnId}:${itemId}` -> manifestPath
	const cxUndoStackByThread = new Map<string, string[]>(); // threadId -> snapshot keys (LIFO)

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

			const [ocOk, ccOk, cxOk, piStatus] = await Promise.all([
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
					version: 'version' in piStatus ? piStatus.version : undefined,
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
	// In production binaries, do not allow environment flags to weaken enforcement.
	const requireEntitlement = compiled
		? true
		: isTruthyEnv(process.env.BROSKI_REQUIRE_ENTITLEMENT, !!options.cloud?.requireEntitlement);
	// Defense-in-depth: if we're compiled but entitlement somehow got disabled, abort.
	// This catches scenarios where someone patches the `compiled` const or ternary above.
	if (compiled && !requireEntitlement) {
		throw new Error("FATAL: Entitlement enforcement disabled in compiled binary. Binary may be tampered.");
	}
	const convexHttpBaseUrlRaw = (
		compiled
			? (options.cloud?.convexHttpBaseUrl ?? "")
			: (options.cloud?.convexHttpBaseUrl ??
				process.env.BROSKI_CONVEX_HTTP_BASE_URL ??
				process.env.CONVEX_HTTP_BASE_URL ??
				"")
	)
		.trim()
		.replace(/\/+$/, "");
	const convexHttpBaseUrl = (() => {
		if (!convexHttpBaseUrlRaw) return "";
		try {
			const u = new URL(convexHttpBaseUrlRaw);
			if (u.protocol !== "https:" && !(u.protocol === "http:" && !compiled)) return "";
			// Cheap "pinning": require Convex HTTPS hostnames in production.
			if (compiled && !u.hostname.endsWith(".convex.site")) return "";
			return `${u.protocol}//${u.host}`;
		} catch {
			return "";
		}
	})();
	// In production binaries, always enable TLS for any non-loopback access.
	// Allowing BROSKI_TLS=0 creates sniffing/MITM risk on WiFi/hotspot.
	const tlsEnabled = compiled ? true : isTlsEnabledByEnv();
	let tlsMaterial: TlsMaterial | null = null;

	// Claude Code filesystem watchers (skills/plugins/hook/command updates).
	const ccFsWatchers = new Map<
		string,
		{
			watcher: FSWatcher;
			debounce: Timer | null;
			kind: "skills" | "plugins" | "hooks" | "commands" | "mcp";
			cwd?: string;
		}
	>();
	const ensureClaudeWatchDir = (
		dir: string,
		kind: "skills" | "plugins" | "hooks" | "commands" | "mcp",
		cwd?: string,
		recursive = true,
	) => {
		if (!dir || ccFsWatchers.has(dir)) return;

		try {
			const watcher = fsWatch(dir, { persistent: false, recursive }, (_eventType, filename) => {
				const existing = ccFsWatchers.get(dir);
				if (!existing) return;
				if (existing.debounce) clearTimeout(existing.debounce);
				existing.debounce = setTimeout(() => {
					existing.debounce = null;
					broadcast({
						type: "cc_fs_changed",
						data: {
							kind,
							dir,
							...(cwd ? { cwd } : {}),
							...(filename ? { file: String(filename) } : {}),
						},
					});
				}, 150);
			});

			ccFsWatchers.set(dir, { watcher, debounce: null, kind, cwd });
		} catch {
			// Ignore watch failures (dir missing or unsupported)
		}
	};
	const send = (ws: ServerWebSocket<unknown>, message: ServerMessage) => {
		ws.send(JSON.stringify(message));
	};

	const broadcast = (message: ServerMessage) => {
		const payload = JSON.stringify(message);
		for (const ws of sockets) {
			ws.send(payload);
		}
	};

	const ptyRuntime = new PtyRuntime({
		ptyManager,
		send,
		log,
		resolveSecurePath: getSecurePath,
	});

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

							// CRITICAL: Send session.idle to reset UI state
							if (owner) {
								send(owner, {
									type: "sdk_event",
									data: {
										payload: {
											type: "session.idle",
											properties: { sessionID: threadId },
										},
									},
								});
							}
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
						send(owner, {
							type: "sdk_event",
							data: {
								payload: {
									type: "session.status",
									properties: { sessionID: threadId, status: { type: "busy" } },
								},
							},
						});
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
						send(owner, {
							type: "sdk_event",
							data: {
								payload: {
									type: "session.idle",
									properties: { sessionID: threadId },
								},
							},
						});
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
							send(owner, {
								type: "cx_stream",
								threadId,
								data: {
									type: "info",
									message: `Dynamic tool "${safeString(params.tool)}" was requested but is not yet supported by Broski.`,
								} satisfies CodexStreamMessage,
							});
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

					send(owner, {
						type: "cx_stream",
						threadId,
						data: {
							type: "request",
							requestId: String(r.id),
							method: frontendMethod,
							params: enrichedParams,
						} satisfies CodexStreamMessage,
					});

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

						// Reset UI state
						send(owner, {
							type: "sdk_event",
							data: {
								payload: {
									type: "session.idle",
									properties: { sessionID: threadId },
								},
							},
						});
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

					// Reset client so it can be re-created on next request
					codexClient = null;
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
			});
		}

		await codexClient.start();
		return codexClient;
	};

	const getDeviceInfo = (ws: ServerWebSocket<unknown>): DeviceInfo | null => {
		const ctx = contexts.get(ws);
		if (!ctx || !ctx.deviceId) return null;
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
			logDebug,
			DEBUG_RTS,
		});
	};


	const startClaudeCodeExternalTail = (sessionId: string): { stop: () => void } => {
		return _startClaudeCodeExternalTail(sessionId, {
			claudeCode,
			emitCcStream,
			safeString,
			logDebug,
			DEBUG_RTS,
		});
	};

	const resolveCodexExternalSessionFile = (threadId: string) =>
		_resolveCodexExternalSessionFile(threadId);

	const startCodexExternalTail = (threadId: string): { stop: () => void } => {
		return _startCodexExternalTail(threadId, {
			emitCxStream,
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
		const payload: ServerMessage = {
			type: "cc_stream",
			data: streamMsg,
			sessionId,
		};
		// Always look up the CURRENT owner from the map, not a stale captured reference.
		// This is critical: when the app disconnects and reconnects, the old `ws` is dead
		// but `ccSessionOwners` gets updated to the new socket via `set_view`.
		const resolvedOwner = owner ?? ccSessionOwners.get(sessionId) ?? null;
		const key = makeSessionKey("claude-code", sessionId);
		const watchers = key ? sessionWatchers.get(key) : null;

		if (DEBUG_RTS) {
			const msgType = "type" in streamMsg ? String((streamMsg as Record<string, unknown>).type) : "unknown";
			logDebug(
				`[RTS] emitCcStream: session=${sessionId}, msgType=${msgType}, owner=${!!resolvedOwner}, watchers=${watchers?.size ?? 0}`,
			);
		}

		if (resolvedOwner) {
			send(resolvedOwner, payload);
		} else {
			// No owner connected — buffer the event for reconnect replay.
			// The external tail will also sync from disk, but this buffer
			// bridges the gap for events that haven't been flushed to JSONL yet.
			bufferCcEvent(sessionId, streamMsg);
		}
		broadcastToSessionWatchers("claude-code", sessionId, payload, resolvedOwner);

		const runtimeEvent = mapClaudeCodeStreamToRuntimeEvent(streamMsg, {
			backend: "claude-code",
			sessionId,
			cwd: ccSessionCwds.get(sessionId),
		});
		if (!runtimeEvent) return;

		const runtimePayload: ServerMessage = {
			type: "runtime_event",
			backend: "claude-code",
			data: runtimeEvent,
		};
		if (resolvedOwner) {
			send(resolvedOwner, runtimePayload);
		}
		broadcastToSessionWatchers("claude-code", sessionId, runtimePayload, resolvedOwner);
	};

	const emitCxStream = (threadId: string, streamMsg: CodexStreamMessage, owner?: ServerWebSocket<unknown> | null) => {
		const payload: ServerMessage = {
			type: "cx_stream",
			data: streamMsg,
			threadId,
		};
		const key = makeSessionKey("codex", threadId);
		const watchers = key ? sessionWatchers.get(key) : null;
		const resolvedOwner = owner ?? cxThreadOwners.get(threadId) ?? null;

		if (DEBUG_RTS) {
			const msgType = "type" in streamMsg ? String((streamMsg as Record<string, unknown>).type) : "unknown";
			logDebug(
				`[RTS] emitCxStream: thread=${threadId}, msgType=${msgType}, owner=${!!resolvedOwner}, watchers=${watchers?.size ?? 0}`,
			);
		}

		if (resolvedOwner) {
			send(resolvedOwner, payload);
		} else {
			// No owner connected — buffer for reconnect replay
			bufferCxEvent(threadId, streamMsg);
		}
		broadcastToSessionWatchers("codex", threadId, payload, resolvedOwner);

		const runtimeEvent = mapCodexStreamToRuntimeEvent(streamMsg, {
			backend: "codex",
			threadId,
			cwd: cxThreadCwds.get(threadId),
		});
		if (!runtimeEvent) return;

		const runtimePayload: ServerMessage = {
			type: "runtime_event",
			backend: "codex",
			data: runtimeEvent,
		};
		if (resolvedOwner) {
			send(resolvedOwner, runtimePayload);
		}
		broadcastToSessionWatchers("codex", threadId, runtimePayload, resolvedOwner);
	};

	// ── Event buffer for reconnect replay ──────────────────────────────
	// When a CC/CX session is streaming and the app disconnects, events go
	// to a dead socket. The external tail will eventually sync from disk,
	// but there's a gap. This ring buffer keeps the most recent events so
	// on reconnect we can replay them immediately.
	const bufferCcEvent = (sessionId: string, event: any) => {
		let buf = ccEventBuffers.get(sessionId);
		if (!buf) {
			buf = [];
			ccEventBuffers.set(sessionId, buf);
		}
		buf.push({ event, ts: Date.now() });
		if (buf.length > SESSION_EVENT_BUFFER_SIZE) {
			buf.splice(0, buf.length - SESSION_EVENT_BUFFER_SIZE);
		}
	};

	const bufferCxEvent = (threadId: string, event: any) => {
		let buf = cxEventBuffers.get(threadId);
		if (!buf) {
			buf = [];
			cxEventBuffers.set(threadId, buf);
		}
		buf.push({ event, ts: Date.now() });
		if (buf.length > SESSION_EVENT_BUFFER_SIZE) {
			buf.splice(0, buf.length - SESSION_EVENT_BUFFER_SIZE);
		}
	};

	const replayBufferedEvents = (ws: ServerWebSocket<unknown>, agent: "claude-code" | "codex", sessionId: string) => {
		const bufferMap = agent === "claude-code" ? ccEventBuffers : cxEventBuffers;
		const buf = bufferMap.get(sessionId);
		if (!buf || buf.length === 0) return;

		// Only replay events from the last 60 seconds (stale events would confuse the UI)
		const cutoff = Date.now() - 60_000;
		const recent = buf.filter((e) => e.ts >= cutoff);
		if (recent.length === 0) return;

		logInfo(`[RTS] Replaying ${recent.length} buffered events for ${agent}:${sessionId}`);
		for (const { event } of recent) {
			if (agent === "claude-code") {
				emitCcStream(sessionId, event, ws);
			} else {
				emitCxStream(sessionId, event, ws);
			}
		}

		// Clear buffer after replay (external tail will take over)
		bufferMap.delete(sessionId);
	};

	let eventCount = 0;
	let eventCountResetTimer: Timer | null = null;

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

	const getEventPriority = (event: unknown): "immediate" | "high" | "normal" | "low" => {
		const eventType = getEventType(event);
		return MESSAGE_PRIORITIES[eventType] ?? "normal";
	};

	const getBatchInterval = (ctx: ConnectionContext): number => {
		const rtt = ctx.lastRttMs;

		let thresholds = BATCH_THRESHOLDS.local;
		if (rtt > 100) {
			thresholds = BATCH_THRESHOLDS.highLatency;
		} else if (rtt > 30 || ctx.connectionType === "tailscale") {
			thresholds = BATCH_THRESHOLDS.tailscale;
		}

		if (eventCount > 50) return thresholds.burst;
		if (eventCount > 20) return thresholds.high;
		return thresholds.low;
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

	const flushClientQueue = (ws: ServerWebSocket<unknown>) => {
		const clientQ = clientQueues.get(ws);
		if (!clientQ || clientQ.queue.length === 0) return;

		clientQ.timer = null;
		const events = clientQ.queue.splice(0, clientQ.queue.length);

		const filtered = events.filter((event) => filterEventForSocket(ws, event));
		if (filtered.length > 0) {
			send(ws, { type: "sdk_event_batch", data: filtered });
		}
	};

	const enqueueForClient = (ws: ServerWebSocket<unknown>, event: unknown) => {
		let clientQ = clientQueues.get(ws);
		if (!clientQ) {
			clientQ = { queue: [], timer: null };
			clientQueues.set(ws, clientQ);
		}

		clientQ.queue.push(event);

		if (clientQ.timer) return;

		const ctx = contexts.get(ws) ?? {
			lastPongAt: Date.now(),
			lastRttMs: 0,
			connectionType: "unknown" as const,
			connectedAt: Date.now(),
		};
		const batchMs = getBatchInterval(ctx);

		clientQ.timer = setTimeout(() => flushClientQueue(ws), batchMs);
	};

	const enqueueSdkEvent = (event: unknown) => {
		eventCount++;

		if (!eventCountResetTimer) {
			eventCountResetTimer = setTimeout(() => {
				eventCount = 0;
				eventCountResetTimer = null;
			}, 1000);
		}

		const priority = getEventPriority(event);
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
				`[RTS] enqueueSdkEvent: type=${eventType}, sessionId=${sid || "none"}, dir=${directory}, priority=${priority}, sockets=${sockets.size}`,
			);
		}

		let deliveredCount = 0;
		for (const ws of sockets) {
			if (!filterEventForSocket(ws, event)) continue;
			deliveredCount++;

			if (priority === "immediate" || priority === "high") {
				send(ws, { type: "sdk_event", data: event });
			} else {
				enqueueForClient(ws, event);
			}

			if (runtimeEvent) {
				send(ws, {
					type: "runtime_event",
					backend: "opencode",
					data: runtimeEvent,
				});
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
			if (ctx.pendingPing) continue;

			const ping = {
				id: `ping_${now}_${Math.floor(Math.random() * 1_000_000)}`,
				sentAt: now,
			};
			ctx.pendingPing = ping;
			send(ws, { type: "ping", data: ping });
		}
	}, HEARTBEAT_INTERVAL_MS);

	// Tick timer: Simple liveness signal to all connected clients.
	// Clients should expect a tick every TICK_INTERVAL_MS. If 2x interval passes
	// without a tick, the client should consider the connection dead and reconnect.
	const tickTimer = setInterval(() => {
		const now = Date.now();
		const tickPayload = {
			type: "tick",
			timestamp: now,
			interval: TICK_INTERVAL_MS,
		};
		for (const ws of sockets) {
			try {
				ws.send(JSON.stringify(tickPayload));
			} catch {
				// Client might have disconnected, ignore
			}
		}
	}, TICK_INTERVAL_MS);

	// Periodic entitlement refresh (best-effort). This makes revocations take effect
	// without requiring the client to reconnect.
	const entitlementRefreshTimer = setInterval(() => {
		if (!requireEntitlement) return;
		void (async () => {
			for (const ws of sockets) {
				const ctx = contexts.get(ws);
				if (!ctx?.cloudAuthed || !ctx.cloudSessionToken) continue;
				await refreshCloudEntitlement(ws, ctx, "timer");
			}
		})().catch(() => {});
	}, 60_000);

	const ALLOWED_PROXY_PORTS = buildProxyPortAllowlist();

	const httpDeps: HandleHttpDeps = {
		tlsEnabled,
		webDistDir,
		version,
		allowedProxyPorts: ALLOWED_PROXY_PORTS,
		opencode,
		listFilesDirectly,
		logUser,
		entitlementDeps: {
			requireEntitlement,
			safeString,
			convexHttpBaseUrl,
			ENTITLEMENT_CACHE_TTL_MS,
			OFFLINE_GRACE_MS,
			entitlementCache,
			getLocalLicense: () => localLicense,
			setLocalLicense: (l) => { localLicense = l; },
		},
	};


	const MAX_WS_MESSAGE_BYTES = Math.max(
		1024 * 1024, // 1MB minimum
		Math.min(Number(process.env.BROSKI_MAX_WS_MESSAGE_MB ?? "15") * 1024 * 1024, 200 * 1024 * 1024), // cap at 200MB
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
						try {
							ws.send(typeof evt.data === "string" ? evt.data : new Uint8Array(evt.data as ArrayBuffer));
						} catch {
							// ignore
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
			logInfo(`[WS] Client CONNECTED (${sockets.size} total) - requireEntitlement=${requireEntitlement}`);
			scheduleCloudAuthDeadline(ws);
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
			clearCloudAuthTimer(ws);
			const ctx = contexts.get(ws);
			logInfo(
				`[WS] Disconnect context - cloudAuthed=${ctx?.cloudAuthed}, cloudEntitled=${ctx?.cloudEntitled}, deviceId=${ctx?.deviceId}`,
			);
			const disconnectedDeviceId = ctx?.deviceId;
			const disconnectedDeviceName = ctx?.deviceName;
			const prevKey = makeSessionKey(ctx?.viewAgent, ctx?.sessionId);
			updateSessionWatchers(ws, prevKey, null);

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
			const clientQ = clientQueues.get(ws);
			if (clientQ?.timer) {
				clearTimeout(clientQ.timer);
			}
			clientQueues.delete(ws);

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


	const secureServer = Bun.serve({
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
	const securePort = secureServer.port ?? options.port;

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

	const processSingleMessage = async (
		ws: ServerWebSocket<unknown>,
		message: ClientMessage & { requestId?: string },
		reply: (response: ServerMessage) => void,
	) => {
		const cloudAuthRequiredMessageTypes = new Set(["auth_session", "pong", "client_ping", "batch"]);
		const ctx = contexts.get(ws);
		if (requireEntitlement && !cloudAuthRequiredMessageTypes.has(message.type)) {
			if (!ctx?.cloudAuthed || !ctx.cloudEntitled) {
				reply({
					type: "error",
					message: "LICENSE_REQUIRED",
					code: "LICENSE_REQUIRED",
					requestId: message.requestId,
				});
				try {
					ws.close(4403, "License required");
				} catch {
					// ignore
				}
				return;
			}
			if (typeof ctx.licenseExpSec === "number") {
				const nowSec = Math.floor(Date.now() / 1000);
				if (nowSec > ctx.licenseExpSec) {
					reply({
						type: "error",
						message: "LICENSE_EXPIRED",
						code: "LICENSE_EXPIRED",
						requestId: message.requestId,
					});
					try {
						ws.close(4403, "License expired");
					} catch {
						// ignore
					}
					return;
				}
			}
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

		if (message.type.startsWith("pi_")) {
			const handled = await piFeatures.handle(message, reply, broadcast);
			if (!handled) {
				reply({
					type: "error",
					message: `Unhandled Pi feature: ${message.type}`,
					requestId: message.requestId,
				});
			}
			return;
		}

		if (await ocRouting.handle(message, reply, {
			requireOpenCode,
			safeString,
			getSecurePath,
			readFileDirectly,
			readFileBinaryDirectly,
			listFilesDirectly,
			fileSearch,
			recentChatMessageIds,
			ocSessionOwners,
			ws,
			syncExternalTailForKey,
			makeSessionKey,
		})) return;
		if (ccElicitation.handle(message, ccElicitationWaiters)) return;

		if (
			await handleAuth(message, reply, {
				requireEntitlement,
				convexHttpBaseUrl,
				ENTITLEMENT_CACHE_TTL_MS,
				OFFLINE_GRACE_MS,
				entitlementCache,
				contexts,
				ws,
				ctx,
				clearCloudAuthTimer,
				log,
				logUser,
				logInfo,
				toErrorMessage,
				getLocalLicense: () => localLicense,
				setLocalLicense: (l) => {
					localLicense = l;
				},
			})
		)
			return;
		if (
			await handleCcChat(message, reply, {
				claudeCode,
				safeString,
				log,
				ws,
				send,
				ccSessionOwners,
				ccSessionCwds,
				ccPermissionWaiters,
				ccElicitationWaiters,
				ccEventBuffers,
				PERMISSION_TIMEOUT_MS,
				buildClaudeCodeRuntimeState,
				broadcastToSessionWatchers,
				emitCcStream,
				enqueueSdkEvent,
				syncExternalTailForKey,
				makeSessionKey,
			})
		)
			return;
		// ── Extracted handler routing ──────────────────────────────────────
		// Device management (register_device, list_devices, disconnect_device)
		if (await devicesHandler.handle(ws, message as Record<string, unknown>, reply, {
			sockets,
			contexts,
			ALLOWED_DEVICE_IDS,
			BRIDGE_PROTOCOL_VERSION,
			getDeviceInfo,
			getAllDevices,
			findSocketByDeviceId,
			send,
			broadcast,
			sendStatus,
			logUser,
			logError,
			safeString,
			claudeCode,
			opencode,
			ccPermissionWaiters,
			ccElicitationWaiters,
			cxApprovalWaiters,
			cxActiveTurns,
			cxThreadCwds,
			ocSessionProjectPaths,
			buildClaudeCodeRuntimeState,
			buildCodexRuntimeState,
			mapOpenCodeStatusToRuntimeState,
			listPiActiveSessionSnapshots,
			buildPiActiveRuntimeStateMessages,
		})) return;

		// Session view (set_view)
		if (await sessionViewHandler.handle(ws, message as Record<string, unknown>, reply, {
			contexts,
			sockets,
			send,
			sendStatus,
			logInfo,
			logDebug,
			DEBUG_RTS,
			currentAgent,
			ensureClaudeWatchDir,
			makeSessionKey,
			updateSessionWatchers,
			sessionWatchers,
			claudeCode,
			ccSessionOwners,
			ccSessionCwds,
			buildClaudeCodeRuntimeState,
			replayBufferedEvents,
			cxActiveTurns,
			cxThreadOwners,
			cxThreadCwds,
			buildCodexRuntimeState,
			ocSessionOwners,
			ocSessionProjectPaths,
			findPiActiveRuntimeStateMessage,
		})) return;

		// Codex (cx_*) routing
		if (await cxRouting.handle(message as Record<string, unknown>, reply, {
			ws,
			ensureCodexClient,
			codexClient,
			codexFs,
			safeString,
			getSecurePath,
			logInfo,
			logError,
			logDebug,
			DEBUG_CX_GLOBAL,
			send,
			broadcastToSessionWatchers,
			cxProjectCache,
			setProjectCache: (cache) => { cxProjectCache = cache; },
			cxThreadCache,
			CODEX_PROJECT_CACHE_TTL_MS,
			CODEX_THREAD_CACHE_TTL_MS,
			cxThreadNames,
			cxThreadOwners,
			cxThreadCwds,
			cxActiveTurns,
			cxApprovalWaiters,
			mapCodexThread,
			mapCodexThreadToRuntimeSession,
			invalidateCodexCaches,
			buildCodexRuntimeState,
			emitCxStream,
			ensureUndoStack,
			applyCodexUndo,
		})) return;

		// Misc (pong, client_ping, restart_opencode, set_agent, get_agents_status, usage)
		if (await miscHandler.handle(ws, message as Record<string, unknown>, reply, {
			contexts,
			send,
			log,
			getCurrentAgent: () => currentAgent,
			setCurrentAgent: (agent) => { currentAgent = agent; },
			ensureClaudeWatchDir,
			claudeCode,
			checkCodexAvailable,
			getBackendsStatus,
			restartOpenCode: options.restartOpenCode,
		})) return;

		// ── Remaining inline cases (small, deep closure coupling) ─────────
		switch (message.type) {
			// PTY Terminal Sessions
			case "list_pty":
			case "create_pty":
			case "get_pty":
			case "update_pty":
			case "delete_pty":
			case "pty_connect":
			case "pty_input":
			case "pty_disconnect":
			case "pty_resize": {
				await ptyRuntime.handleMessage(ws, message, reply);
				break;
			}
			// Git operations
			case "git_diff":
			case "git_status":
			case "git_log":
			case "git_branches":
			case "git_stage":
			case "git_unstage":
			case "git_revert_file":
			case "git_commit":
			case "git_push":
			case "git_pull":
			case "git_fetch":
			case "git_checkout":
			case "git_create_branch":
			case "git_stash":
			case "git_stash_pop":
			case "git_commit_diff":
			case "github_remote":
			case "github_issues":
			case "github_prs":
			case "github_pr_diff":
			case "github_pr_comments": {
				const handled = await handleGitFeature(message, reply, {
					getSecurePath,
					safeString,
				});
				if (!handled) {
					reply({
						type: "error",
						message: `Unhandled Git feature: ${message.type}`,
					});
				}
				break;
			}
			// CC message routing (delegated to handlers/cc_routing.ts)
			default: {
				const ccHandled = await ccRouting.handle(message as Record<string, unknown>, reply, {
					claudeCode,
					mapClaudeCodeSessionToRuntimeSession,
					mapClaudeCodeModelToSummary,
					safeString,
					getSecurePath,
					isSafeClaudeCommandName,
					resolveClaudeCommandFilePath,
					ccPermissionWaiters,
				});
				if (!ccHandled) {
					reply({ type: "error", message: "Unknown message type" });
				}
			}
		}

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

		// Defense-in-depth: enforce entitlement before even entering the main
		// per-message switch (a patched `processSingleMessage` should not be enough).
		if (requireEntitlement) {
			const allowed = new Set(["auth_session", "pong", "client_ping", "batch"]);
			if (!allowed.has(message.type)) {
				const c = contexts.get(ws);
				if (!c?.cloudAuthed || !c.cloudEntitled) {
					log(`[MSG] BLOCKED ${message.type} - cloudAuthed=${c?.cloudAuthed}, cloudEntitled=${c?.cloudEntitled}`);
					reply({
						type: "error",
						message: "LICENSE_REQUIRED",
						code: "LICENSE_REQUIRED",
					});
					try {
						ws.close(4403, "License required");
					} catch {
						// ignore
					}
					return;
				}
				if (typeof c.licenseExpSec === "number") {
					const nowSec = Math.floor(Date.now() / 1000);
					if (nowSec > c.licenseExpSec) {
						reply({
							type: "error",
							message: "LICENSE_EXPIRED",
							code: "LICENSE_EXPIRED",
						});
						try {
							ws.close(4403, "License expired");
						} catch {
							// ignore
						}
						return;
					}
				}
			}
		}

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
			clearInterval(entitlementRefreshTimer);
			for (const t of cloudAuthTimers.values()) clearTimeout(t);
			cloudAuthTimers.clear();
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
			for (const t of ccExternalTails.values()) {
				try {
					t.stop();
				} catch {
					// ignore
				}
			}
			ccExternalTails.clear();
			ccEventBuffers.clear();
			for (const t of cxExternalTails.values()) {
				try {
					t.stop();
				} catch {
					// ignore
				}
			}
			cxExternalTails.clear();
			cxEventBuffers.clear();
			for (const w of ccFsWatchers.values()) {
				if (w.debounce) clearTimeout(w.debounce);
				try {
					w.watcher.close();
				} catch {
					// ignore
				}
			}
			ccFsWatchers.clear();
			void ptyRuntime.stop().catch((error) => {
				logError(`[PTY] stop cleanup failed: ${toErrorMessage(error)}`);
			});
			pi.disposeAll();
			try {
				secureServer.stop(force);
			} catch {
				// ignore
			}
			if (loopbackServer) {
				try {
					loopbackServer.stop(force);
				} catch {
					// ignore
				}
			}
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

