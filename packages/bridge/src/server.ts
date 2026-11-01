import type { ServerWebSocket } from "bun";
import type { AuthTokenState } from "./auth-token";
import {
	listFilesDirectly as _listFilesDirectly,
	readFileBinaryDirectly as _readFileBinaryDirectly,
	readFileDirectly as _readFileDirectly,
} from "./file-ops";
import { toErrorMessage } from "./http-utils";
import { releaseFailedBindResources } from "./lifecycle/bridge-teardown";
import type { TeardownResult } from "./lifecycle/teardown";
import type { BridgeLogger } from "./logging/logger";
import { isCompiledBinary } from "./platform";
import { PtyRuntime } from "./pty/runtime";
import { createMessageRegistry } from "./routing/routes";
import { getSecurePath } from "./security";
import { createBackends } from "./server/backends";
import { keepsOldHook, setClaudeCodeHooks } from "./server/claude-code-hooks";
import type { ClaudeCodeWiring } from "./server/claude-code-wiring";
import { createConnections } from "./server/connections";
import { type ContractOptions, createContractSeam } from "./server/contract-seam";
import { buildServerDeps } from "./server/deps";
import { createFsWatchers } from "./server/fs-watchers";
import { createHttpWiring } from "./server/http";
import { startBridgeIntervals } from "./server/intervals";
import { createLimits } from "./server/limits";
import { attachLinkDecisionPath } from "./server/link-feed/feed";
import { startConfiguredLinkIngress } from "./server/link-start";
import { createLeveledLogger } from "./server/logger";
import { serveLoopback } from "./server/loopback-listener";
import { createMessageHandler } from "./server/messages";
import { DEFAULT_PERMISSION_TIMEOUT_MS } from "./server/permission-waiter";
import { createSessions, type Sessions } from "./server/sessions";
import { createStop } from "./server/shutdown";
import { createBridgeState } from "./server/state";
import { createStreams } from "./server/streams";
import { ensureTlsMaterial } from "./tls";
import type { AgentType, ServerMessage } from "./types";

// Re-export for backward compatibility (external consumers import from './server')
export { type AuthTokenState, loadOrCreateAuthState, loadOrCreateAuthToken } from "./auth-token";

// Debug flags are dev-only — disabled in compiled binaries to prevent leaking
// session IDs, file paths, and internal state in production console output.
// All log calls go through the leveled logger (logUser/logInfo/logDebug/logError)
// which writes to the log file always and filters console output by level.
const DEBUG_RTS = !isCompiledBinary() && process.env.BROSKI_DEBUG_RTS === "1";

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
	currentAgent?: AgentType;
	version: string;
	auth: AuthTokenState;
	/** How long an unanswered CC approval waits before it is auto-rejected. Defaults to 10 min. */
	permissionTimeoutMs?: number;
	/** Unix socket the broski-link daemon connects to; served without token auth. */
	linkSocket?: string;
	/** The daemon's key file, which every upgrade on that socket must quote. */
	linkKeyFile?: string;
	/** @deprecated Use bridgeLogger instead. Kept for backward compat. */
	logger?: (message: string) => void;
	/** Leveled logger. If not provided, falls back to legacy `logger` as info-level. */
	bridgeLogger?: BridgeLogger;
	/** The bridge core that speaks the contract protocol; without it, the core serves no backend. */
	contract?: ContractOptions;
	/** `claudeCode.contract` and what it switches (`server/claude-code-wiring.ts`); absent: the old path only. */
	claudeCode?: ClaudeCodeWiring;
};

export type BridgeServer = {
	broadcast: (message: ServerMessage) => void;
	/** Resolves once every async cleanup finished or the teardown budget elapsed. */
	stop: (force?: boolean) => Promise<TeardownResult>;
	connections: () => number;
	port: () => number;
	authToken: () => string;
	tls: () => { enabled: boolean; certSha256: string | null };
};

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
	const log = createLeveledLogger({ bridgeLogger: options.bridgeLogger, logger: options.logger });
	const permissionTimeoutMs = options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS;
	const limits = createLimits();

	const state = createBridgeState({
		auth: options.auth,
		defaultAgent: options.currentAgent || "claude-code",
		limits,
		logInfo: log.logInfo,
	});

	const backends = createBackends();
	const streams = createStreams({ state, log, debugRts: DEBUG_RTS });
	const fsWatchers = createFsWatchers({ broadcast: streams.broadcast });
	const ptyRuntime = new PtyRuntime({
		ptyManager: state.ptyManager,
		send: streams.send,
		log: log.log,
		resolveSecurePath: getSecurePath,
	});

	const sessions: Sessions = createSessions({
		state,
		streams,
		log,
		debugRts: DEBUG_RTS,
	});

	const sendStatus = async (ws: ServerWebSocket<unknown>): Promise<void> => {
		const ctx = state.contexts.get(ws);
		const activeAgent: AgentType = ctx?.viewAgent ?? state.currentAgent;
		const backendsStatus = await backends.getBackendsStatus();
		streams.send(ws, {
			type: "status",
			data: {
				activeAgent,
				backends: backendsStatus,
			},
		});
	};

	startBridgeIntervals({ state, streams, log });

	const http = createHttpWiring({
		state,
		streams,
		log,
		limits,
		version: options.version,
		listFilesDirectly,
		debugRts: DEBUG_RTS,
		terminalHook: options.claudeCode?.receiver,
	});

	if (state.tlsEnabled) {
		state.tlsMaterial = await ensureTlsMaterial();
	} else {
		log.log("[Security] BROSKI_TLS=0 set. Running WITHOUT transport encryption for direct connections.");
	}

	const contract = createContractSeam(options.contract, options.version, state.runtimeSendQueue, limits, log);
	options.claudeCode?.connect(contract);

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
		contract,
	});

	const serverDeps = buildServerDeps({
		state,
		streams,
		sessions,
		backends,
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
		permissionTimeoutMs,
		debugRts: DEBUG_RTS,
	});
	const messageRegistry = createMessageRegistry(serverDeps);
	handleMessage = createMessageHandler({
		registry: messageRegistry,
		serverDeps,
		send: streams.send,
		maxBatchSize: limits.maxBatchSize,
		getSecurePath,
		contract,
	});
	attachLinkDecisionPath(messageRegistry, serverDeps, contract.answer);

	let secureServer: ReturnType<typeof Bun.serve>;
	try {
		state.linkIngress = await startConfiguredLinkIngress({
			linkSocket: options.linkSocket,
			linkKeyFile: options.linkKeyFile,
			state,
			connections,
			limits,
			log,
		});
		secureServer = serveLoopback({
			port: options.port,
			...(state.tlsMaterial && { tls: state.tlsMaterial }),
			fetch: http.makeFetch(),
			websocket: connections.websocketConfig,
		});
	} catch (error) {
		state.linkIngress?.stop();
		releaseFailedBindResources({
			intervals: [state.heartbeatTimer, state.tickTimer, state.eventBufferPruneTimer],
			closeFsWatchers: () => fsWatchers.closeAll(),
			unregisterSweepables: state.unregisterBoundedState,
		});
		throw error;
	}
	state.secureServer = secureServer;
	state.securePort = secureServer.port ?? options.port;
	contract.start();
	const listener = { port: state.securePort, token: state.authToken, certPath: state.tlsMaterial?.certPath };
	void setClaudeCodeHooks(options.claudeCode, { ...listener, log: log.logInfo }).catch((err) => {
		log.logInfo(`[CC Hook] Install failed (non-fatal): ${toErrorMessage(err)}`);
	});

	const stop = createStop({
		state,
		log,
		fsWatchers,
		ptyRuntime,
		contract,
		keepsOldHook: keepsOldHook(options.claudeCode),
	});

	return {
		broadcast: streams.broadcast,
		stop,
		connections: () => state.sockets.size,
		port: () => state.securePort,
		authToken: () => state.authToken,
		tls: () => ({
			enabled: !!state.tlsMaterial,
			certSha256: state.tlsMaterial?.certSha256 ?? null,
		}),
	};
}
