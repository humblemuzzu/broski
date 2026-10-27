/**
 * Why Pi cannot run a model here, in words the app can show — names only, never a credential value.
 *
 * The catalogue the app offers is `getAvailable()`: models whose provider has credentials. Everything else
 * disappears from the list, which left a user staring at a muted row with no idea that `DEEPSEEK_API_KEY`
 * was simply missing from the bridge's environment. These helpers say which provider is unconfigured and
 * which environment variable the SDK itself reads for it.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, AuthContext, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { minimatch } from "minimatch";
import type { PiHiddenModelsPayload } from "../../types/pi";

const PROVIDER_CHECK_TIMEOUT_MS = 2_000;

/** Pi's own scope syntax: a pattern may pin a thinking level with `:<level>`. */
const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/;

export type CatalogueMatch = { model: Model<Api>; thinkingLevel: ThinkingLevel | null };

function splitThinking(pattern: string): { body: string; thinkingLevel: ThinkingLevel | null } {
	const suffix = THINKING_SUFFIX.exec(pattern);
	if (suffix === null) return { body: pattern, thinkingLevel: null };
	return { body: pattern.slice(0, pattern.length - suffix[0].length), thinkingLevel: suffix[1] as ThinkingLevel };
}

function matchesId(id: string, pattern: string): boolean {
	if (!pattern.includes("*") && !pattern.includes("?")) return id === pattern;
	return minimatch(id, pattern);
}

/**
 * What an `enabledModels` entry names in Pi's full catalogue — including models no credential can run here.
 *
 * The pattern already went through the SDK's own resolution against what is available and matched nothing; this
 * only recovers the name to show on the muted row, so it answers `provider/id`, a bare id and a glob, the three
 * shapes the scope syntax accepts.
 */
export function findInCatalogue(pattern: string, models: readonly Model<Api>[]): CatalogueMatch[] {
	const { body, thinkingLevel } = splitThinking(pattern);

	const slash = body.indexOf("/");
	if (slash > 0) {
		const provider = body.slice(0, slash);
		const rest = body.slice(slash + 1);
		if (models.some((model) => model.provider === provider)) {
			const matches = models.filter((model) => model.provider === provider && matchesId(model.id, rest));
			if (matches.length > 0) return matches.map((model) => ({ model, thinkingLevel }));
		}
	}

	return models
		.filter((model) => matchesId(model.id, body) || `${model.provider}/${model.id}` === body)
		.map((model) => ({ model, thinkingLevel }));
}

/**
 * The environment variables a provider's own auth check reads, discovered without resolving anything:
 * `ApiKeyAuth.check` is the SDK's side-effect-free availability check, and it is only asked which names it
 * looks at. A provider with no such check (an API-key command, OAuth-only) reports none, and the caller
 * names the provider alone.
 */
export async function providerKeyVariables(runtime: ModelRuntime, providerId: string): Promise<string[]> {
	const apiKey = runtime.getProvider(providerId)?.auth.apiKey;
	if (apiKey?.check === undefined) return [];

	const names: string[] = [];
	const ctx: AuthContext = {
		env: async (name: string) => {
			names.push(name);
			return undefined;
		},
		fileExists: async () => false,
	};
	try {
		await apiKey.check({ ctx, signal: AbortSignal.timeout(PROVIDER_CHECK_TIMEOUT_MS) });
	} catch {
		return [];
	}
	return [...new Set(names)];
}

/** One sentence for a selected entry Pi cannot run, or `null` when the provider is signed in. */
export async function unavailableReason(runtime: ModelRuntime, provider: string): Promise<string> {
	if (runtime.getProviderAuthStatus(provider).configured) {
		return `Pi cannot run this model with your ${provider} credential`;
	}

	const variables = await providerKeyVariables(runtime, provider);
	if (variables.length > 0) {
		return `No API key — set ${variables.join(", ")}, or sign in with \`pi\``;
	}
	return `Not signed in for ${provider} — sign in with \`pi\``;
}

/**
 * The models of *the providers the user's own list names* that Pi cannot run here because the provider is not
 * signed in. A whole catalogue's worth of unused providers is not a footer row; a provider the user picked is.
 */
export function hiddenModels(
	runtime: ModelRuntime,
	available: readonly Model<Api>[],
	full: readonly Model<Api>[],
	providers: ReadonlySet<string>,
): PiHiddenModelsPayload {
	const runnable = new Set(available.map((model) => `${model.provider}/${model.id}`));
	const unconfigured = new Map<string, number>();

	for (const model of full) {
		if (!providers.has(model.provider)) continue;
		if (runnable.has(`${model.provider}/${model.id}`)) continue;
		if (runtime.getProviderAuthStatus(model.provider).configured) continue;
		unconfigured.set(model.provider, (unconfigured.get(model.provider) ?? 0) + 1);
	}

	let count = 0;
	for (const models of unconfigured.values()) count += models;
	return { count, providers: [...unconfigured.keys()].sort() };
}
