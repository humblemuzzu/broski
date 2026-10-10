import type { McpServerStatus as SDKMcpServerStatus, Query as SDKQuery } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeCodeAccountInfo, ClaudeCodeMcpServerStatus, ClaudeCodeSupportedModel } from "../../types";
import { normalizeSupportedModels } from "./model-normalization";
import {
	activeSessions,
	ccAccountInfoByCwd,
	ccMcpStatusByCwd,
	ccSupportedModelsByCwd,
	cwdCacheKey,
	fallbackSupportedModels,
} from "./shared";

function normalizeAccountInfo(data: unknown): ClaudeCodeAccountInfo {
	if (!data || typeof data !== "object") return {};
	const raw = data as Record<string, unknown>;
	return {
		...(typeof raw.email === "string" ? { email: raw.email } : {}),
		...(typeof raw.organization === "string" ? { organization: raw.organization } : {}),
		...(typeof raw.subscriptionType === "string" ? { subscriptionType: raw.subscriptionType } : {}),
		...(typeof raw.tokenSource === "string" ? { tokenSource: raw.tokenSource } : {}),
		...(typeof raw.apiKeySource === "string" ? { apiKeySource: raw.apiKeySource } : {}),
		...(typeof raw.accountUuid === "string" ? { accountUuid: raw.accountUuid } : {}),
		...(typeof raw.organizationUuid === "string" ? { organizationUuid: raw.organizationUuid } : {}),
		apiProvider: typeof raw.apiProvider === "string" ? raw.apiProvider : null,
	};
}

function normalizeMcpServerStatuses(statuses: unknown): ClaudeCodeMcpServerStatus[] {
	if (!Array.isArray(statuses)) return [];
	return statuses
		.map((item) => {
			if (!item || typeof item !== "object") return null;
			const raw = item as Partial<SDKMcpServerStatus>;
			const name = String(raw.name ?? "").trim();
			const status = String(raw.status ?? "").trim();
			if (!name) return null;
			if (
				status !== "connected" &&
				status !== "failed" &&
				status !== "needs-auth" &&
				status !== "pending" &&
				status !== "disabled"
			) {
				return null;
			}
			const info = raw.serverInfo;
			const serverInfo =
				info && typeof info === "object"
					? {
							name: String(info.name ?? "").trim(),
							version: String(info.version ?? "").trim(),
						}
					: undefined;
			const errorMsg = typeof raw.error === "string" ? raw.error : undefined;
			const scope = typeof raw.scope === "string" ? raw.scope : undefined;
			const rawTools = raw.tools;
			const tools =
				rawTools
					?.map((t) => {
						const entry: {
							name: string;
							description?: string;
							annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean };
						} = {
							name: String(t?.name ?? ""),
						};
						if (typeof t?.description === "string") entry.description = t.description;
						if (t?.annotations && typeof t.annotations === "object") {
							const ann: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } = {};
							if (typeof t.annotations.readOnly === "boolean") ann.readOnly = t.annotations.readOnly;
							if (typeof t.annotations.destructive === "boolean") ann.destructive = t.annotations.destructive;
							if (typeof t.annotations.openWorld === "boolean") ann.openWorld = t.annotations.openWorld;
							if (Object.keys(ann).length > 0) entry.annotations = ann;
						}
						return entry;
					})
					.filter((t) => t.name) ?? undefined;
			// Forward server config (B12: URLs, transport type)
			const rawConfig = raw.config;
			const config = rawConfig && typeof rawConfig === "object" ? rawConfig : undefined;
			return {
				name,
				status,
				...(serverInfo?.name && serverInfo.version ? { serverInfo } : {}),
				...(errorMsg ? { error: errorMsg } : {}),
				...(config ? { config } : {}),
				...(scope ? { scope } : {}),
				...(tools && tools.length > 0 ? { tools } : {}),
			} as ClaudeCodeMcpServerStatus;
		})
		.filter((item): item is ClaudeCodeMcpServerStatus => item != null);
}

function normalizeModelUsage(modelUsage: unknown):
	| Record<
			string,
			{
				inputTokens: number;
				outputTokens: number;
				cacheReadInputTokens: number;
				cacheCreationInputTokens: number;
				webSearchRequests: number;
				costUSD: number;
				contextWindow: number;
				maxOutputTokens: number;
			}
	  >
	| undefined {
	if (!modelUsage || typeof modelUsage !== "object") return undefined;
	const entries = Object.entries(modelUsage as Record<string, unknown>);
	if (entries.length === 0) return undefined;

	const normalizedEntries = entries
		.map(([modelName, usage]) => {
			if (!usage || typeof usage !== "object") return null;
			const raw = usage as Record<string, unknown>;
			const normalized = {
				inputTokens: Number(raw.inputTokens ?? 0) || 0,
				outputTokens: Number(raw.outputTokens ?? 0) || 0,
				cacheReadInputTokens: Number(raw.cacheReadInputTokens ?? 0) || 0,
				cacheCreationInputTokens: Number(raw.cacheCreationInputTokens ?? 0) || 0,
				webSearchRequests: Number(raw.webSearchRequests ?? 0) || 0,
				costUSD: Number(raw.costUSD ?? 0) || 0,
				contextWindow: Number(raw.contextWindow ?? 0) || 0,
				maxOutputTokens: Number(raw.maxOutputTokens ?? 0) || 0,
			};
			return [modelName, normalized] as const;
		})
		.filter(
			(
				item,
			): item is readonly [
				string,
				{
					inputTokens: number;
					outputTokens: number;
					cacheReadInputTokens: number;
					cacheCreationInputTokens: number;
					webSearchRequests: number;
					costUSD: number;
					contextWindow: number;
					maxOutputTokens: number;
				},
			] => item != null,
		);

	if (normalizedEntries.length === 0) return undefined;
	return Object.fromEntries(normalizedEntries);
}

function normalizePermissionDenials(
	permissionDenials: unknown,
): Array<{ toolName: string; toolUseId: string; toolInput?: Record<string, unknown> }> | undefined {
	if (!Array.isArray(permissionDenials) || permissionDenials.length === 0) return undefined;

	const normalized = permissionDenials
		.map((entry) => {
			if (!entry || typeof entry !== "object") return null;
			const raw = entry as Record<string, unknown>;
			const toolName = typeof raw.tool_name === "string" ? raw.tool_name : "";
			const toolUseId = typeof raw.tool_use_id === "string" ? raw.tool_use_id : "";
			if (!toolName || !toolUseId) return null;

			const toolInput =
				raw.tool_input && typeof raw.tool_input === "object" && !Array.isArray(raw.tool_input)
					? (raw.tool_input as Record<string, unknown>)
					: undefined;

			return {
				toolName,
				toolUseId,
				...(toolInput ? { toolInput } : {}),
			};
		})
		.filter(
			(entry): entry is { toolName: string; toolUseId: string; toolInput?: Record<string, unknown> } => entry != null,
		);

	return normalized.length > 0 ? normalized : undefined;
}

function pickContextWindow(
	modelUsage: Record<string, { contextWindow: number }> | undefined,
	preferredModel?: string,
): number | undefined {
	if (!modelUsage || Object.keys(modelUsage).length === 0) return undefined;
	if (preferredModel && modelUsage[preferredModel]?.contextWindow) {
		return modelUsage[preferredModel].contextWindow;
	}
	const first = Object.values(modelUsage).find((entry) => entry.contextWindow > 0);
	return first?.contextWindow;
}

function cacheCapabilities(
	cwd: string | undefined,
	capabilities: {
		supportedModels?: ClaudeCodeSupportedModel[];
		accountInfo?: ClaudeCodeAccountInfo;
		mcpStatuses?: ClaudeCodeMcpServerStatus[];
	},
): void {
	const key = cwdCacheKey(cwd);
	if (capabilities.supportedModels && capabilities.supportedModels.length > 0) {
		ccSupportedModelsByCwd.set(key, capabilities.supportedModels);
	}
	if (capabilities.accountInfo && Object.keys(capabilities.accountInfo).length > 0) {
		ccAccountInfoByCwd.set(key, capabilities.accountInfo);
	}
	if (capabilities.mcpStatuses && capabilities.mcpStatuses.length > 0) {
		ccMcpStatusByCwd.set(key, capabilities.mcpStatuses);
	}
}

async function collectCapabilitiesFromQuery(
	q: any,
	cwd?: string,
): Promise<{
	supportedModels?: ClaudeCodeSupportedModel[];
	accountInfo?: ClaudeCodeAccountInfo;
	mcpStatuses?: ClaudeCodeMcpServerStatus[];
}> {
	const [modelsResult, accountResult, mcpResult] = await Promise.allSettled([
		typeof q?.supportedModels === "function" ? q.supportedModels() : Promise.resolve([]),
		typeof q?.accountInfo === "function" ? q.accountInfo() : Promise.resolve({}),
		typeof q?.mcpServerStatus === "function" ? q.mcpServerStatus() : Promise.resolve([]),
	]);

	const supportedModels = modelsResult.status === "fulfilled" ? normalizeSupportedModels(modelsResult.value) : [];
	const accountInfo = accountResult.status === "fulfilled" ? normalizeAccountInfo(accountResult.value) : {};
	const mcpStatuses = mcpResult.status === "fulfilled" ? normalizeMcpServerStatuses(mcpResult.value) : [];

	cacheCapabilities(cwd, { supportedModels, accountInfo, mcpStatuses });

	return {
		...(supportedModels.length > 0 ? { supportedModels } : {}),
		...(Object.keys(accountInfo).length > 0 ? { accountInfo } : {}),
		...(mcpStatuses.length > 0 ? { mcpStatuses } : {}),
	};
}

async function callActiveSessionCapability<T>(
	cwd: string | undefined,
	method: (q: SDKQuery) => Promise<T>,
): Promise<T | undefined> {
	const normalizedCwd = (cwd || "").trim();
	for (const [, session] of activeSessions.entries()) {
		if (normalizedCwd && session.cwd !== normalizedCwd) continue;
		if (!session.query) continue;
		try {
			return await method(session.query);
		} catch {}
	}
	return undefined;
}

export async function getSupportedModels(cwd?: string): Promise<ClaudeCodeSupportedModel[]> {
	const key = cwdCacheKey(cwd);
	const cached = ccSupportedModelsByCwd.get(key);
	if (cached && cached.length > 0) return cached;

	const fromActive = await callActiveSessionCapability(cwd, async (q) => {
		const normalized = normalizeSupportedModels(await q.supportedModels());
		if (normalized.length > 0) {
			ccSupportedModelsByCwd.set(key, normalized);
		}
		return normalized;
	});
	if (Array.isArray(fromActive) && fromActive.length > 0) return fromActive;

	const fallback = fallbackSupportedModels();
	ccSupportedModelsByCwd.set(key, fallback);
	return fallback;
}

export async function getAccountInfo(cwd?: string): Promise<ClaudeCodeAccountInfo> {
	const key = cwdCacheKey(cwd);
	const cached = ccAccountInfoByCwd.get(key);
	if (cached) return cached;

	const fromActive = await callActiveSessionCapability(cwd, async (q) => {
		const normalized = normalizeAccountInfo(await q.accountInfo());
		if (Object.keys(normalized).length > 0) {
			ccAccountInfoByCwd.set(key, normalized);
		}
		return normalized;
	});
	if (fromActive && Object.keys(fromActive).length > 0) return fromActive;

	return {};
}

export async function getMcpServerStatus(cwd?: string): Promise<ClaudeCodeMcpServerStatus[]> {
	const key = cwdCacheKey(cwd);
	const cached = ccMcpStatusByCwd.get(key);
	if (cached && cached.length > 0) return cached;

	const fromActive = await callActiveSessionCapability(cwd, async (q) => {
		const normalized = normalizeMcpServerStatuses(await q.mcpServerStatus());
		if (normalized.length > 0) {
			ccMcpStatusByCwd.set(key, normalized);
		}
		return normalized;
	});
	if (Array.isArray(fromActive) && fromActive.length > 0) return fromActive;

	return [];
}

export {
	cacheCapabilities,
	collectCapabilitiesFromQuery,
	normalizeAccountInfo,
	normalizeMcpServerStatuses,
	normalizeModelUsage,
	normalizePermissionDenials,
	pickContextWindow,
};
