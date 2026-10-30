/**
 * Why Pi cannot run a model here, in words the phone can show: names of providers and variables, never a credential.
 * The variables are asked of the provider's own key resolution (`ApiKeyAuth.resolve`, pi-ai `src/auth/types.ts`), given
 * an environment that holds nothing and notes every name it is asked for; the package exports no list of them
 * (`findEnvKeys` is not in its root) and no 1.4.0 provider offers the side-effect-free `check`. It is asked only of
 * a provider with no credential, so a `models.json` key that is a command is never run for this.
 */

import type { ApiKeyAuth, AuthContext } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { MAX_NAME_CHARS } from "../../../contract";
import { clipStart } from "../bounds";
import { rowText } from "../phone-text";

/** A resolution that waits on anything but the environment is not asked for long. */
const RESOLVE_TIMEOUT_MS = 2_000;

const variablesOf = new WeakMap<ApiKeyAuth, Promise<readonly string[]>>();

export async function unavailableReason(runtime: ModelRuntime, providerId: string): Promise<string> {
	const name = rowText(runtime.getProvider(providerId)?.name ?? "") || providerId;
	if (runtime.getProviderAuthStatus(providerId).configured) {
		return clipStart(`The ${name} credentials Pi has do not include this model.`, MAX_NAME_CHARS);
	}
	const variables = await keyVariables(runtime, providerId);
	const looks = variables.length === 0 ? "" : ` Pi reads ${variables.join(", ")} from the bridge's environment.`;
	return clipStart(`Not signed in to ${name}: sign in with /login in pi.${looks}`, MAX_NAME_CHARS);
}

function keyVariables(runtime: ModelRuntime, providerId: string): Promise<readonly string[]> {
	const apiKey = runtime.getProvider(providerId)?.auth.apiKey;
	if (apiKey === undefined) return Promise.resolve([]);
	const known = variablesOf.get(apiKey);
	if (known !== undefined) return known;
	const asking = askVariables(apiKey);
	variablesOf.set(apiKey, asking);
	return asking;
}

async function askVariables(apiKey: ApiKeyAuth): Promise<readonly string[]> {
	const names = new Set<string>();
	const context: AuthContext = {
		env: async (name) => {
			names.add(name);
			return undefined;
		},
		fileExists: async () => false,
	};
	try {
		await apiKey.resolve({ ctx: context, signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
	} catch {
		return [];
	}
	return [...names];
}
