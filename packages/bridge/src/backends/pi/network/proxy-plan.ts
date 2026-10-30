/**
 * What Pi's `httpProxy` setting comes to inside the bridge. The terminal puts it into `HTTP_PROXY` and `HTTPS_PROXY`
 * for its own process unless the environment already names them (pi-coding-agent `src/core/http-dispatcher.ts:45-50`,
 * `??=`). In the bridge those variables would send every backend's requests, its update checks and its link through
 * the proxy, so the plan is applied to Pi's requests only (`scoped-runtime.ts`).
 */

import { LOOPBACK_NO_PROXY } from "./no-proxy";

/** The proxies Pi's requests use. A scheme the environment names itself is absent: Bun reads it there. */
export interface ProxyPlan {
	readonly http?: string;
	readonly https?: string;
	readonly noProxy: string;
}

export type ProxyOutcome =
	| { readonly kind: "none" }
	| { readonly kind: "environment" }
	| { readonly kind: "unusable"; readonly setting: string; readonly reason: string }
	| { readonly kind: "scoped"; readonly plan: ProxyPlan };

function named(env: NodeJS.ProcessEnv, upper: string): boolean {
	return env[upper] !== undefined || env[upper.toLowerCase()] !== undefined;
}

function problemWith(setting: string): string | undefined {
	let url: URL;
	try {
		url = new URL(setting);
	} catch {
		return "it is not a URL; write it as http://host:port";
	}
	return url.protocol === "http:" || url.protocol === "https:"
		? undefined
		: "only http:// and https:// proxies are supported";
}

export function proxyOutcome(setting: string | undefined, env: NodeJS.ProcessEnv): ProxyOutcome {
	if (setting === undefined) return { kind: "none" };
	const problem = problemWith(setting);
	if (problem !== undefined) return { kind: "unusable", setting, reason: problem };
	const http = named(env, "HTTP_PROXY") ? undefined : setting;
	const https = named(env, "HTTPS_PROXY") ? undefined : setting;
	if (http === undefined && https === undefined) return { kind: "environment" };
	const user = env.NO_PROXY ?? env.no_proxy;
	return {
		kind: "scoped",
		plan: {
			...(http !== undefined && { http }),
			...(https !== undefined && { https }),
			noProxy: user ? `${LOOPBACK_NO_PROXY},${user}` : LOOPBACK_NO_PROXY,
		},
	};
}

/** The variables Pi's providers read their own proxy from (`ProviderRequestOptions.env`, pi-ai `src/types.ts`). */
export function providerEnv(plan: ProxyPlan): Record<string, string> {
	return {
		...(plan.http !== undefined && { HTTP_PROXY: plan.http }),
		...(plan.https !== undefined && { HTTPS_PROXY: plan.https }),
		NO_PROXY: plan.noProxy,
	};
}
