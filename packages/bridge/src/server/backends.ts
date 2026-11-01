import * as claudeCode from "../connectors/claude-code";
import type { AgentStatusInfo, AgentType } from "../types";

const BACKEND_STATUS_TTL_MS = 1500;

export type Backends = {
	getBackendsStatus: () => Promise<Record<AgentType, AgentStatusInfo>>;
};

export function createBackends(): Backends {
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
			let ccOk = false;
			try {
				ccOk = await claudeCode.checkClaudeCodeAvailable();
			} catch {
				ccOk = false;
			}
			const data: Record<AgentType, AgentStatusInfo> = {
				"claude-code": {
					available: ccOk,
					authMethod: ccOk ? (envKey ? "api-key" : "claude-login") : undefined,
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

	return { getBackendsStatus };
}
