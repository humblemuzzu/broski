import { resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import type { AuthTokenState } from "./auth-token";
import type { OpenCodeConnector } from "./connectors/opencode";
import {
	listFilesDirectly as _listFilesDirectly,
	readFileBinaryDirectly as _readFileBinaryDirectly,
	readFileDirectly as _readFileDirectly,
} from "./file-ops";
import { installCcHook } from "./handlers/cc_hook_installer";
import { installCxHook } from "./handlers/cx_hook_installer";
import { toErrorMessage } from "./http-utils";
import { releaseFailedBindResources } from "./lifecycle/bridge-teardown";
import type { TeardownResult } from "./lifecycle/teardown";
import type { BridgeLogger } from "./logging/logger";
import { isCompiledBinary } from "./platform";
import { PtyRuntime } from "./pty/runtime";
import { createMessageRegistry } from "./routing/routes";
import { getSecurePath } from "./security";
import { createAuth } from "./server/auth";
import { createBackends } from "./server/backends";
import { createCodexCaches } from "./server/codex-caches";
import { createCodexClient } from "./server/codex-client";
import { createCodexFileUndo } from "./server/codex-file-undo";
import { createCodexNotificationHandler } from "./server/codex-notifications";
import { createCodexRequestHandler } from "./server/codex-requests";
import { createConnections } from "./server/connections";
import { buildServerDeps } from "./server/deps";
import { createFsWatchers } from "./server/fs-watchers";
import { createHttpWiring } from "./server/http";
import { startBridgeIntervals } from "./server/intervals";
import { createLimits } from "./server/limits";
import { attachLinkDecisionPath } from "./server/link-feed/feed";
import { startLinkIngress } from "./server/link-ingress";
import { createLeveledLogger } from "./server/logger";
import { createMessageHandler } from "./server/messages";
import { createOpenCodeEvents } from "./server/opencode-events";
import { DEFAULT_PERMISSION_TIMEOUT_MS } from "./server/permission-waiter";
import { createSessions, type Sessions } from "./server/sessions";
import { createStop } from "./server/shutdown";
import { createBridgeState } from "./server/state";
import { createStreams } from "./server/streams";
import { safeString } from "./server/util";
import { ensureTlsMaterial } from "./tls";
import type { AgentType, ServerMessage } from "./types";

// Re-export for backward compatibility (external consumers import from './server')
export { type AuthTokenState, loadOrCreateAuthState, loadOrCreateAuthToken } from "./auth-token";

// Debug flags are dev-only — disabled in compiled binaries to prevent leaking
// session IDs, file paths, and internal state in production console output.
// All log calls go through the leveled logger (logUser/logInfo/logDebug/logError)
// which writes to the log file always and filters console output by level.
const DEBUG_RTS = !isCompiledBinary() && process.env.BROSKI_DEBUG_RTS === "1";
const DEBUG_CX_GLOBAL = !isCompiledBinary() && process.env.BROSKI_DEBUG_CX_GLOBAL === "1";

/**
 * Permission/approval timeout: 10 minutes.
 * Users may background the app for extended periods; auto-rejecting after 2 minutes
 * kills long-running sessions that need approval. 10 min gives enough time for
 * app background → resume → approve flow, even on slow networks.
 */
export const PERMISSION_TIMEOUT_MS = DEFAULT_PERMISSION_TIMEOUT_MS;

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
	/** How long an unanswered CC/CX approval waits before it is auto-rejected. Defaults to 10 min. */
	permissionTimeoutMs?: number;
	/**
	 * When true, also starts a loopback-only plaintext WS/HTTP server used for
	 * Tailscale Funnel (which terminates TLS at the edge and proxies to localhost).
	 */
	enableLoopbackInsecureServer?: boolean;
	/** Unix socket the broski-link daemon connects to; served without token auth. */
	linkSocket?: string;
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

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
	const log = createLeveledLogger({ bridgeLogger: options.bridgeLogger, logger: options.logger });
	const permissionTimeoutMs = options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS;
	const limits = createLimits();

	// Web dashboard dist directory (served by bridge HTTP when present).
	const webDistDir = (() => {
		const fromEnv = safeString(process.env.BROSKI_WEB_DIST).trim();
		if (fromEnv) return resolve(fromEnv);
		// repo layout: packages/bridge/src -> ../../web-app/dist
		return resolve(import.meta.dir, "..", "..", "web-app", "dist");
	})();

	const state = createBridgeState({
		opencode: options.opencode,
		auth: options.auth,
		webDistDir,
		defaultAgent: options.currentAgent || "opencode",
		logInfo: log.logInfo,
	});

	const backends = createBackends({ state, opencode: options.opencode, version: options.version });
	const streams = createStreams({ state, log, debugRts: DEBUG_RTS });
	const fsWatchers = createFsWatchers({ broadcast: streams.broadcast });
	const ptyRuntime = new PtyRuntime({
		ptyManager: state.ptyManager,
		send: streams.send,
		log: log.log,
		resolveSecurePath: getSecurePath,
	});

	let sessions!: Sessions;
	const opencodeEvents = createOpenCodeEvents({
		state,
		streams,
		log,
		debugRts: DEBUG_RTS,
		requireOpenCode: backends.requireOpenCode,
		syncExternalTailForKey: (key) => sessions.syncExternalTailForKey(key),
	});
	sessions = createSessions({
		state,
		streams,
		log,
		debugRts: DEBUG_RTS,
		opencode: options.opencode,
		startOpenCodeExternalTail: opencodeEvents.startOpenCodeExternalTail,
	});

	const codexCaches = createCodexCaches();
	const codexFileUndo = createCodexFileUndo({ state, getSecurePath });
	const codexNotifications = createCodexNotificationHandler({
		state,
		streams,
		sessions,
		fileUndo: codexFileUndo,
		log,
		debugCxGlobal: DEBUG_CX_GLOBAL,
		getSecurePath,
	});
	const codexRequests = createCodexRequestHandler({
		state,
		emitCxStream: streams.emitCxStream,
		logInfo: log.logInfo,
		permissionTimeoutMs,
	});
	const codexClient = createCodexClient({
		state,
		streams,
		sessions,
		onNotification: codexNotifications,
		onServerRequest: codexRequests,
		log,
	});

	const auth = createAuth({ state, tokenTtlDays: options.tokenTtlDays, logUser: log.logUser });

	const sendStatus = async (ws: ServerWebSocket<unknown>): Promise<void> => {
		const ctx = state.contexts.get(ws);
		const activeAgent: AgentType = ctx?.viewAgent ?? state.currentAgent;
		const backendsStatus = await backends.getBackendsStatus();
		streams.send(ws, {
			type: "status",
			data: {
				opencodeRunning: backendsStatus.opencode.available,
				activeAgent,
				backends: backendsStatus,
			},
		});
	};

	const intervals = startBridgeIntervals({ state, streams, log, getSecurePort: () => state.securePort });

	const http = createHttpWiring({
		state,
		streams,
		log,
		limits,
		auth,
		version: options.version,
		opencode: options.opencode,
		listFilesDirectly,
		debugRts: DEBUG_RTS,
	});

	if (state.tlsEnabled) {
		state.tlsMaterial = await ensureTlsMaterial();
	} else {
		log.log("[Security] BROSKI_TLS=0 set. Running WITHOUT transport encryption for direct connections.");
	}

	// The message handler needs the device helpers on `connections`, and `connections` needs the
	// message handler at socket-message time — wire the handler in after it exists.
	let handleMessage!: (ws: ServerWebSocket<unknown>, raw: string | Uint8Array) => Promise<void>;
	const connections = createConnections({
		state,
		streams,
		sessions,
		log,
		limits,
		ptyRuntime,
		sendStatus,
		handleMessage: (ws, raw) => handleMessage(ws, raw),
	});

	const serverDeps = buildServerDeps({
		state,
		streams,
		sessions,
		backends,
		codexClient,
		codexCaches,
		opencodeEvents,
		codexFileUndo,
		fsWatchers,
		connections,
		limits,
		log,
		ptyRuntime,
		sendStatus,
		readFileDirectly,
		readFileBinaryDirectly,
		listFilesDirectly,
		version: options.version,
		opencode: options.opencode,
		restartOpenCode: options.restartOpenCode,
		permissionTimeoutMs,
		debugRts: DEBUG_RTS,
		debugCxGlobal: DEBUG_CX_GLOBAL,
	});
	const messageRegistry = createMessageRegistry(serverDeps);
	handleMessage = createMessageHandler({
		registry: messageRegistry,
		serverDeps,
		send: streams.send,
		maxBatchSize: limits.maxBatchSize,
		getSecurePath,
	});
	attachLinkDecisionPath(messageRegistry, serverDeps);

	let secureServer: ReturnType<typeof Bun.serve>;
	try {
		state.linkIngress = options.linkSocket
			? await startLinkIngress({ socketPath: options.linkSocket, state, connections, limits, log })
			: null;
		secureServer = Bun.serve({
			// If TLS is disabled, only bind to loopback to avoid exposing plaintext traffic on LAN/WiFi.
			...(state.tlsMaterial ? {} : { hostname: "127.0.0.1" }),
			port: options.port,
			...(state.tlsMaterial
				? {
						tls: {
							key: Bun.file(state.tlsMaterial.keyPath),
							cert: Bun.file(state.tlsMaterial.certPath),
						},
					}
				: {}),
			fetch: http.makeFetch("secure"),
			websocket: connections.websocketConfig,
		});
	} catch (error) {
		state.linkIngress?.stop();
		releaseFailedBindResources({
			intervals: [state.heartbeatTimer, state.tickTimer, state.eventBufferPruneTimer],
			stopEndpointWatcher: () => intervals.endpointWatcher.stop(),
			closeFsWatchers: () => fsWatchers.closeAll(),
			unregisterSweepables: state.unregisterBoundedState,
		});
		throw error;
	}
	state.secureServer = secureServer;
	state.securePort = secureServer.port ?? options.port;

	// Install CC permission hook in ~/.claude/settings.json (non-blocking)
	void installCcHook(state.securePort, state.authToken, log.logInfo).catch((err) => {
		log.logInfo(`[CC Hook] Install failed (non-fatal): ${toErrorMessage(err)}`);
	});

	// Install CX permission hook in ~/.codex/hooks.json (non-blocking)
	void installCxHook(state.securePort, state.authToken, log.logInfo).catch((err) => {
		log.logInfo(`[CX Hook] Install failed (non-fatal): ${toErrorMessage(err)}`);
	});

	if (options.enableLoopbackInsecureServer) {
		state.loopbackServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: http.makeFetch("loopback"),
			websocket: connections.websocketConfig,
		});
		state.loopbackPort = state.loopbackServer.port ?? null;
		if (state.loopbackPort) {
			log.log(`[Funnel] Loopback backend listening on 127.0.0.1:${state.loopbackPort}`);
		}
	}

	const stop = createStop({
		state,
		log,
		fsWatchers,
		ptyRuntime,
		codexClient,
		endpointWatcher: intervals.endpointWatcher,
	});

	return {
		broadcast: streams.broadcast,
		enqueueSdkEvent: opencodeEvents.enqueueSdkEvent,
		stop,
		connections: () => state.sockets.size,
		port: () => state.securePort,
		funnelBackendPort: () => state.loopbackPort,
		authToken: () => state.authToken,
		tls: () => ({
			enabled: !!state.tlsMaterial,
			certSha256: state.tlsMaterial?.certSha256 ?? null,
		}),
	};
}
