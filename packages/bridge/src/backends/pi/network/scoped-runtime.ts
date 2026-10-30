/**
 * Pi's `httpProxy` for Pi's requests only. The shared `ModelRuntime` is what every hosted session sends its model
 * requests through (the agent loop, compaction and extensions' nested calls all go to its `stream*` and `complete*`),
 * and a request takes two options of its own that carry a proxy (pi-ai `src/types.ts`, `ProviderRequestOptions`):
 * `fetch`, which the OpenAI, Azure, Anthropic, Mistral, Codex and Pi providers hand their HTTP client, and `env`,
 * which Bedrock and the Codex WebSocket read `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` from. The runtime handed to
 * Pi's sessions adds them to each request, so nothing else in the process, and no environment variable, changes.
 *
 * Not covered, because Pi gives them no option: the Google providers refuse a custom `fetch` (pi-ai
 * `src/api/google-generative-ai.ts:87-89`, `google-vertex.ts:96-98`), a sign-in's token refresh calls the global
 * `fetch` (`src/auth/oauth/*.ts`), and so do extensions and MCP servers; a `bash` tool's child process takes the bridge's own
 * environment. `status()` names the first two when they apply.
 */

import type { Api, FetchFunction, ProviderEnv } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { bypassesProxy } from "./no-proxy";
import { type ProxyPlan, providerEnv } from "./proxy-plan";

/** The APIs whose adapter throws when given a `fetch` of its own. */
export const REFUSES_CUSTOM_FETCH: ReadonlySet<Api> = new Set(["google-generative-ai", "google-vertex"]);

/** The `ModelRuntime` methods that send a chat request: `(model, context-or-handle, options)`. */
const REQUEST_METHODS: ReadonlySet<string | symbol> = new Set(["stream", "complete", "streamSimple", "completeSimple"]);

interface RequestOptions {
	fetch?: FetchFunction;
	env?: ProviderEnv;
}

function requestUrl(input: Parameters<FetchFunction>[0]): URL | undefined {
	try {
		if (input instanceof URL) return input;
		return new URL(typeof input === "string" ? input : input.url);
	} catch {
		return undefined;
	}
}

function proxyFor(plan: ProxyPlan, url: URL): string | undefined {
	const proxy = url.protocol === "https:" ? plan.https : url.protocol === "http:" ? plan.http : undefined;
	return proxy === undefined || bypassesProxy(url, plan.noProxy) ? undefined : proxy;
}

/** `fetch` that sends a request through the plan's proxy, except one to this machine, one on `NO_PROXY` or one over a unix socket. */
export function proxiedFetch(plan: ProxyPlan, base: FetchFunction = fetch): FetchFunction {
	return Object.assign(
		(input: Parameters<FetchFunction>[0], init?: Parameters<FetchFunction>[1]) => {
			const url = requestUrl(input);
			const proxy = url === undefined || (init !== undefined && "unix" in init) ? undefined : proxyFor(plan, url);
			return base(input, proxy === undefined ? init : { ...init, proxy });
		},
		{ preconnect: base.preconnect },
	);
}

function scoped<T extends RequestOptions>(model: { readonly api: Api }, options: T | undefined, plan: ProxyPlan): T {
	const own = options ?? ({} as T);
	return {
		...own,
		env: { ...providerEnv(plan), ...own.env },
		...(own.fetch === undefined && !REFUSES_CUSTOM_FETCH.has(model.api) && { fetch: proxiedFetch(plan) }),
	};
}

/** `runtime` with the plan `current()` gives, if any, added to each chat request; every other member is `runtime`'s own. */
export function withProxy(runtime: ModelRuntime, current: () => ProxyPlan | undefined): ModelRuntime {
	return new Proxy(runtime, {
		get(target, property) {
			const member: unknown = Reflect.get(target, property, target);
			if (typeof member !== "function") return member;
			const bound = member.bind(target);
			if (!REQUEST_METHODS.has(property)) return bound;
			return (model: { readonly api: Api }, second: unknown, options?: RequestOptions) => {
				const plan = current();
				return bound(model, second, plan === undefined ? options : scoped(model, options, plan));
			};
		},
	});
}
