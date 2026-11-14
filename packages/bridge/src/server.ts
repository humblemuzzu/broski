import type { AuthTokenState } from "./auth-token";
import { toErrorMessage } from "./http-utils";
import type { TeardownResult } from "./lifecycle/teardown";
import type { BridgeLogger } from "./logging/logger";
import { setClaudeCodeTerminalHook } from "./server/claude-code-hooks";
import type { ClaudeCodeWiring } from "./server/claude-code-wiring";
import { createConnections } from "./server/connections";
import { type ContractOptions, createContractSeam } from "./server/contract-seam";
import { createHttpFetch } from "./server/http";
import { createLimits } from "./server/limits";
import { attachLinkDecisionPath } from "./server/link-feed/feed";
import { startConfiguredLinkIngress } from "./server/link-start";
import { createLeveledLogger } from "./server/logger";
import { serveLoopback } from "./server/loopback-listener";
import { createStop } from "./server/shutdown";
import { createBridgeState } from "./server/state";
import { sweepBoundedState } from "./state/bounded-map";
import { ensureTlsMaterial } from "./tls";

export { type AuthTokenState, loadOrCreateAuthState, loadOrCreateAuthToken } from "./auth-token";

/** How often the bounded maps (the feed's tracks and requests, the file-search cache) drop idle entries. */
const SWEEP_INTERVAL_MS = 300_000;

export type BridgeServerOptions = {
	port: number;
	version: string;
	auth: AuthTokenState;
	/** Unix socket the broski-link daemon connects to. */
	linkSocket?: string;
	/** The daemon's key file, which every upgrade on that socket must quote. */
	linkKeyFile?: string;
	bridgeLogger?: BridgeLogger;
	/** The bridge core that speaks the contract protocol; without it, the core serves no backend. */
	contract?: ContractOptions;
	/** Claude Code's terminal hook and its receiver (`server/claude-code-wiring.ts`); absent in tests that need neither. */
	claudeCode?: ClaudeCodeWiring;
};

export type BridgeServer = {
	/** Resolves once every async cleanup finished or the teardown budget elapsed. */
	stop: (force?: boolean) => Promise<TeardownResult>;
	connections: () => number;
	port: () => number;
	authToken: () => string;
	tls: () => { enabled: boolean; certSha256: string | null };
};

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
	const log = createLeveledLogger(options.bridgeLogger);
	const limits = createLimits();
	const state = createBridgeState({ auth: options.auth, limits, logInfo: log.logInfo });

	if (state.tlsEnabled) {
		state.tlsMaterial = await ensureTlsMaterial();
	} else {
		log.logInfo("[Security] BROSKI_TLS=0 set. Running WITHOUT transport encryption for direct connections.");
	}

	const contract = createContractSeam(options.contract, options.version, state.sendQueue, limits, log);
	options.claudeCode?.connect(contract);
	attachLinkDecisionPath(contract.answer);
	const connections = createConnections({ state, log, limits, contract });

	state.linkIngress = await startConfiguredLinkIngress({
		linkSocket: options.linkSocket,
		linkKeyFile: options.linkKeyFile,
		state,
		connections,
		limits,
		log,
	});
	try {
		state.secureServer = serveLoopback({
			port: options.port,
			...(state.tlsMaterial && { tls: state.tlsMaterial }),
			fetch: createHttpFetch({
				state,
				log,
				limits,
				version: options.version,
				terminalHook: options.claudeCode?.receiver,
			}),
			websocket: connections.websocketConfig,
		});
	} catch (error) {
		state.linkIngress?.stop();
		throw error;
	}
	state.securePort = state.secureServer.port ?? options.port;
	state.sweepTimer = setInterval(() => sweepBoundedState(), SWEEP_INTERVAL_MS);
	contract.start();
	if (options.claudeCode) {
		const listener = { port: state.securePort, token: state.authToken, certPath: state.tlsMaterial?.certPath };
		void setClaudeCodeTerminalHook(options.claudeCode.terminalAsks, { ...listener, log: log.logInfo }).catch((err) => {
			log.logInfo(`[CC terminal hook] Install failed (non-fatal): ${toErrorMessage(err)}`);
		});
	}

	return {
		stop: createStop({ state, log, contract }),
		connections: () => state.sockets.size,
		port: () => state.securePort,
		authToken: () => state.authToken,
		tls: () => ({
			enabled: !!state.tlsMaterial,
			certSha256: state.tlsMaterial?.certSha256 ?? null,
		}),
	};
}
