import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { openCodeSdk } from "../../sdk/opencode-sdk";
import type { SessionSummary } from "../../types";

export const DEFAULT_OPENCODE_BASE_URL = "http://localhost:4096";
export const OPENCODE_SESSION_CACHE_TTL_MS = 5000;

export type OpenCodeSessionCache = Map<string, { data: SessionSummary[]; fetchedAt: number }>;

export type OpenCodeContext = {
	client: OpencodeClient;
	baseUrl: string;
	sessionCache: OpenCodeSessionCache;
	sessionCacheTtlMs: number;
};

export function createOpenCodeClient(baseUrl: string): OpencodeClient {
	return openCodeSdk().createOpencodeClient({ baseUrl });
}

export function createOpenCodeContext(baseUrl?: string, client?: OpencodeClient): OpenCodeContext {
	const resolvedBaseUrl = baseUrl ?? DEFAULT_OPENCODE_BASE_URL;
	return {
		baseUrl: resolvedBaseUrl,
		client: client ?? createOpenCodeClient(resolvedBaseUrl),
		sessionCache: new Map(),
		sessionCacheTtlMs: OPENCODE_SESSION_CACHE_TTL_MS,
	};
}
