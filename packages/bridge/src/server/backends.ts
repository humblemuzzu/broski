import * as claudeCode from "../connectors/claude-code";
import { checkCodexAvailable } from "../connectors/codex";
import type { OpenCodeConnector } from "../connectors/opencode";
import * as pi from "../connectors/pi";
import * as piDurable from "../handlers/pi_durable";
import type { AgentStatusInfo, AgentType } from "../types";
import { type OpenCodeSlot, OpenCodeUnavailableError } from "./opencode-slot";
import type { BridgeState } from "./state";

const BACKEND_STATUS_TTL_MS = 1500;

export type Backends = {
	getBackendsStatus: () => Promise<Record<AgentType, AgentStatusInfo>>;
	requireOpenCode: () => OpenCodeConnector;
	requireOpenCodeOrNull: () => OpenCodeConnector | null;
	/** Re-runs the "which backend is this machine's default" guess, after OpenCode lands. */
	refreshDefaultAgent: () => Promise<void>;
	/** Drops the cached availability, so the next read reports the backend that just arrived. */
	invalidateStatus: () => void;
};

export function createBackends(deps: { state: BridgeState; opencode: OpenCodeSlot; version: string }): Backends {
	const { state, opencode, version } = deps;
	let backendsCache: { fetchedAt: number; data: Record<AgentType, AgentStatusInfo> } | null = null;
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
					const connector = opencode.current();
					try {
						return connector ? await connector.isRunning() : false;
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

	const requireOpenCode = (): OpenCodeConnector => {
		const connector = opencode.current();
		if (!connector) throw new OpenCodeUnavailableError(opencode.reason() ?? "it is not installed");
		return connector;
	};

	const requireOpenCodeOrNull = (): OpenCodeConnector | null => {
		try {
			return requireOpenCode();
		} catch {
			return null;
		}
	};

	// Default agent is detected from what's available, not hardcoded. The Flutter app also
	// auto-selects on connect, so this is just the server-side default until the first client
	// sets it explicitly.
	const refreshDefaultAgent = async (): Promise<void> => {
		try {
			const backends = await getBackendsStatus();
			if (!backends[state.currentAgent]?.available) {
				if (backends["claude-code"]?.available) state.currentAgent = "claude-code";
				else if (backends.opencode?.available) state.currentAgent = "opencode";
				else if (backends.codex?.available) state.currentAgent = "codex";
				else if (backends.pi?.available) state.currentAgent = "pi";
			}
		} catch {
			// keep default
		}
	};

	void refreshDefaultAgent();

	return {
		getBackendsStatus,
		requireOpenCode,
		requireOpenCodeOrNull,
		refreshDefaultAgent,
		invalidateStatus: () => {
			backendsCache = null;
		},
	};
}
