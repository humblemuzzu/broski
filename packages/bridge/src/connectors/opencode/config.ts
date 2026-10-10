import type { Auth, Config as OpenCodeConfig } from "@opencode-ai/sdk/v2";
import type { ModelInfo, ProviderAuthAuthorization, ProviderAuthMethod, ProviderInfo } from "../../types";
import type { OpenCodeContext } from "./context";

export async function getConfig(ctx: OpenCodeContext, directory?: string) {
	return getConfigForDirectory(ctx, directory);
}

export async function getConfigForDirectory(ctx: OpenCodeContext, directory?: string) {
	const { data } = await ctx.client.config.get(directory ? { directory } : {});
	return data;
}

export async function updateConfig(ctx: OpenCodeContext, config: OpenCodeConfig, directory?: string) {
	const { data } = await ctx.client.config.update({
		...(directory && directory.length > 0 ? { directory } : {}),
		config,
	});
	return data;
}

export async function updateModel(ctx: OpenCodeContext, model: string, directory?: string) {
	return updateConfig(ctx, { model }, directory);
}

export async function listProviders(ctx: OpenCodeContext) {
	const { data } = await ctx.client.config.providers({});
	return data;
}

type RawSdkModel = {
	id?: string;
	name?: string;
	family?: string;
	limit?: { context?: number; output?: number };
	reasoning?: boolean;
	attachment?: boolean;
	tool_call?: boolean;
	modalities?: { input?: string[]; output?: string[] };
	status?: string;
	experimental?: boolean;
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	variants?: Record<string, Record<string, unknown>>;
};

function mapModels(rawModels: Record<string, unknown>): Record<string, ModelInfo> {
	const mappedModels: Record<string, ModelInfo> = {};
	for (const [modelId, model] of Object.entries(rawModels)) {
		const m = model as RawSdkModel;
		mappedModels[modelId] = {
			id: m.id ?? modelId,
			name: m.name ?? modelId,
			family: m.family ?? undefined,
			contextWindow: m.limit?.context ?? undefined,
			outputLimit: m.limit?.output ?? undefined,
			reasoning: m.reasoning ?? undefined,
			attachment: m.attachment ?? undefined,
			toolCall: m.tool_call ?? undefined,
			modalities: m.modalities as { input: string[]; output: string[] } | undefined,
			status: m.status as ModelInfo["status"],
			experimental: m.experimental ?? undefined,
			pricing: m.cost
				? {
						input: m.cost.input ?? 0,
						output: m.cost.output ?? 0,
						cacheRead: m.cost.cache_read ?? undefined,
						cacheWrite: m.cost.cache_write ?? undefined,
					}
				: undefined,
			variants: m.variants ?? undefined,
		};
	}
	return mappedModels;
}

export async function listAllProviders(ctx: OpenCodeContext, directory?: string): Promise<ProviderInfo> {
	try {
		const { data: result } = await ctx.client.provider.list({ directory });
		return {
			all: (result?.all ?? []).map((p) => ({
				id: p.id ?? "",
				name: p.name ?? p.id ?? "",
				models: mapModels(p.models ?? {}),
			})),
			default: result?.default ?? {},
			connected: result?.connected ?? [],
		};
	} catch {
		return { all: [], default: {}, connected: [] };
	}
}

export async function getProviderAuth(
	ctx: OpenCodeContext,
	directory?: string,
): Promise<Record<string, ProviderAuthMethod[]>> {
	try {
		const { data: result } = await ctx.client.provider.auth({ directory });
		const mapped: Record<string, ProviderAuthMethod[]> = {};
		for (const [providerId, methods] of Object.entries(result ?? {})) {
			const methodList = Array.isArray(methods) ? (methods as any[]) : [];
			mapped[providerId] = methodList.map((m) => ({
				type: m.type === "oauth" ? ("oauth" as const) : ("api" as const),
				label: m.label,
				name: m.name,
				description: m.description,
				url: m.url,
				prompts: Array.isArray(m.prompts) ? m.prompts : undefined,
			}));
		}
		return mapped;
	} catch {
		return {};
	}
}

export async function providerOauthAuthorize(
	ctx: OpenCodeContext,
	providerId: string,
	method: number,
	directory?: string,
	inputs?: Record<string, string>,
): Promise<ProviderAuthAuthorization | null> {
	try {
		const { data: result } = await ctx.client.provider.oauth.authorize({
			providerID: providerId,
			directory,
			method,
			...(inputs ? { inputs } : {}),
		});
		if (!result) return null;
		return {
			url: result.url ?? "",
			method: result.method === "code" ? "code" : "auto",
			instructions: result.instructions ?? "",
		};
	} catch {
		return null;
	}
}

export async function providerOauthCallback(
	ctx: OpenCodeContext,
	providerId: string,
	method: number,
	code?: string,
	directory?: string,
): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.provider.oauth.callback({
			providerID: providerId,
			directory,
			method,
			...(code ? { code } : {}),
		});
		return result === true;
	} catch {
		return false;
	}
}

export async function authSet(ctx: OpenCodeContext, providerId: string, auth: Auth): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.auth.set({ providerID: providerId, auth });
		return result === true;
	} catch {
		return false;
	}
}

export async function authRemove(ctx: OpenCodeContext, providerId: string): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.auth.remove({ providerID: providerId });
		return result === true;
	} catch {
		return false;
	}
}

export async function getGlobalConfig(ctx: OpenCodeContext): Promise<Record<string, unknown>> {
	try {
		const { data: result } = await ctx.client.global.config.get();
		return result ?? {};
	} catch {
		return {};
	}
}

export async function updateGlobalConfig(
	ctx: OpenCodeContext,
	config: OpenCodeConfig,
): Promise<Record<string, unknown>> {
	try {
		const { data: result } = await ctx.client.global.config.update({ config });
		return result ?? {};
	} catch {
		return {};
	}
}
