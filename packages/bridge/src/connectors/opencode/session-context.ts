import type { SessionContextInfo } from "../../types";
import { listAllProviders } from "./config";
import type { OpenCodeContext } from "./context";
import { getLspStatus } from "./lsp";
import { getSessionMessages } from "./messages";
import { getSessionDiff } from "./sessions";

type AssistantUsage = {
	totalCost: number;
	lastAssistant: any;
};

function collectAssistantUsage(messages: any[] | undefined): AssistantUsage {
	let totalCost = 0;
	let lastAssistant: any = null;

	for (const msg of messages ?? []) {
		const info = msg?.info;
		if (info?.role === "assistant") {
			totalCost += info.cost ?? 0;
			const tokens = info.tokens;
			if (tokens && (tokens.input ?? 0) + (tokens.output ?? 0) > 0) {
				lastAssistant = info;
			}
		}
	}

	return { totalCost, lastAssistant };
}

function extractTokenBreakdown(lastAssistant: any) {
	const lastTokens = lastAssistant?.tokens;
	const lastCache = lastTokens?.cache;
	return {
		lastTokens,
		inputTokens: lastTokens?.input ?? 0,
		outputTokens: lastTokens?.output ?? 0,
		reasoningTokens: lastTokens?.reasoning ?? 0,
		cacheReadTokens: lastCache && typeof lastCache === "object" ? (lastCache.read ?? 0) : 0,
		cacheWriteTokens: lastCache && typeof lastCache === "object" ? (lastCache.write ?? 0) : 0,
	};
}

async function resolveContextWindow(
	ctx: OpenCodeContext,
	lastAssistant: any,
	directory: string | undefined,
	fallback: number,
): Promise<number> {
	const lastProviderID: string | undefined = lastAssistant?.providerID;
	const lastModelID: string | undefined = lastAssistant?.modelID;
	if (!lastProviderID || !lastModelID) return fallback;

	try {
		const providers = await listAllProviders(ctx, directory);
		const provider = providers.all.find((p) => p.id === lastProviderID);
		const model = provider?.models?.[lastModelID];
		const cw = model?.contextWindow;
		if (typeof cw === "number" && cw > 0) {
			return cw;
		}
	} catch {
		// Fall back to default if provider list fails
	}
	return fallback;
}

function mapModifiedFiles(diffs: any[] | null | undefined) {
	return (diffs ?? []).map((diff: any) => ({
		file: diff.file ?? "",
		additions: diff.additions ?? 0,
		deletions: diff.deletions ?? 0,
	}));
}

export async function getSessionContext(
	ctx: OpenCodeContext,
	sessionId: string,
	directory?: string,
): Promise<SessionContextInfo> {
	const messages = await getSessionMessages(ctx, sessionId, directory);
	const diffs = await getSessionDiff(ctx, sessionId, directory);
	const lsp = await getLspStatus(ctx, directory);

	const { totalCost, lastAssistant } = collectAssistantUsage(messages);
	const { lastTokens, inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens } =
		extractTokenBreakdown(lastAssistant);

	const contextWindow = await resolveContextWindow(ctx, lastAssistant, directory, 200000);
	const modifiedFiles = mapModifiedFiles(diffs);
	const contextTokens = inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;

	return {
		tokens: {
			input: inputTokens,
			output: outputTokens,
			total: lastTokens?.total ?? inputTokens + outputTokens,
			contextTokens,
			contextWindow,
			reasoning: reasoningTokens || undefined,
			cacheRead: cacheReadTokens || undefined,
			cacheWrite: cacheWriteTokens || undefined,
		},
		cost: totalCost,
		lsp,
		modifiedFiles,
	};
}
