/** What `status()` says about Pi's `httpProxy`: only what the scoping of `scoped-runtime.ts` cannot reach. */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProxyOutcome } from "./proxy-plan";
import { REFUSES_CUSTOM_FETCH } from "./scoped-runtime";

const IN_THE_SHELL = "Set HTTPS_PROXY in your shell profile and restart the bridge to cover it.";

type Listed = Pick<Model<Api>, "provider" | "api">;

function providersOf(models: readonly Listed[], keep: (model: Listed) => boolean): string[] {
	return [...new Set(models.filter(keep).map((model) => model.provider))];
}

export function proxyWarnings(
	outcome: ProxyOutcome,
	runtime: Pick<ModelRuntime, "isUsingOAuth">,
	available: readonly Listed[],
): string[] {
	if (outcome.kind === "unusable") {
		return [`Pi's httpProxy (${outcome.setting}) is not used: ${outcome.reason}.`];
	}
	if (outcome.kind !== "scoped") return [];
	const google = providersOf(available, (model) => REFUSES_CUSTOM_FETCH.has(model.api));
	const accounts = providersOf(available, (model) => runtime.isUsingOAuth(model.provider));
	return [
		...(google.length > 0
			? [
					`Pi's httpProxy does not reach the ${google.join(", ")} models: their adapter takes no proxy of its own. ${IN_THE_SHELL}`,
				]
			: []),
		...(accounts.length > 0
			? [`Pi's httpProxy does not reach the token refresh of the ${accounts.join(", ")} sign-in. ${IN_THE_SHELL}`]
			: []),
	];
}
