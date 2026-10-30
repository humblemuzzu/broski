import type { Api, Model } from "@earendil-works/pi-ai";
import { type SettingsManager, VERSION } from "@earendil-works/pi-coding-agent";
import { type BackendStatus, MAX_LIST_ITEMS, MAX_TEXT_CHARS, type StatusIssue } from "../../contract";
import { clipStart } from "./bounds";
import { errorText } from "./error-text";
import { isDirectory } from "./is-directory";
import type { ModelRuntimeHost } from "./models/model-runtime";
import type { ProxySetting } from "./network/proxy-setting";
import { proxyWarnings } from "./network/proxy-status";
import { settingsOf } from "./project-settings";

/** What `status()` reports besides Pi's own state: its `httpProxy` setting, and whether the terminal link works. */
export interface StatusExtras {
	readonly proxy: ProxySetting;
	readonly link?: { problem(): string | undefined };
}

function issue(severity: StatusIssue["severity"], message: string): StatusIssue {
	return { severity, message: clipStart(message, MAX_TEXT_CHARS) };
}

/** The default model the settings name when it is not among `available`; Pi then starts another one. */
function missingDefault(settings: SettingsManager, available: readonly Model<Api>[]): string | undefined {
	const provider = settings.getDefaultProvider();
	const id = settings.getDefaultModel();
	if (provider === undefined || id === undefined) return undefined;
	const present = available.some((model) => model.provider === provider && model.id === id);
	return present ? undefined : `${provider}/${id}`;
}

async function probe(models: ModelRuntimeHost, agentDir: string, extras: StatusExtras): Promise<BackendStatus> {
	const { models: available, error } = await models.available();
	const signedIn = models.runtime.getProviders().some((provider) => models.runtime.hasConfiguredAuth(provider.id));
	const usable = available.length > 0;
	const issues: StatusIssue[] = [];
	if (!isDirectory(agentDir)) issues.push(issue("warning", `Pi's agent directory ${agentDir} does not exist.`));
	if (error !== undefined) issues.push(issue(usable ? "warning" : "error", error));
	if (!usable) {
		issues.push(
			issue(
				"error",
				signedIn
					? "No model is available to the signed-in providers."
					: "No provider is signed in. Run `pi` and use /login, or set a provider's API key.",
			),
		);
	}
	const settings = settingsOf(undefined, agentDir);
	const missing = usable ? missingDefault(settings, available) : undefined;
	if (missing !== undefined) issues.push(issue("warning", `The default model ${missing} is not available.`));
	issues.push(...(await scopeWarnings(settings, models)));
	for (const warning of proxyWarnings(extras.proxy.outcome(), models.runtime, available))
		issues.push(issue("warning", warning));
	const linkProblem = extras.link?.problem();
	if (linkProblem !== undefined) issues.push(issue("warning", linkProblem));
	return {
		installed: true,
		version: VERSION,
		auth: signedIn ? "signed_in" : "signed_out",
		usable,
		issues: issues.slice(0, MAX_LIST_ITEMS),
	};
}

/**
 * What is wrong with the user's `enabledModels` (a pattern that matches nothing, an ambiguous one, a thinking
 * level a model lacks), which the terminal prints at its start (pi-coding-agent `src/core/model-resolver.ts:412-421`).
 * The global settings only: a project's own `enabledModels` belongs to a cwd, which a status has not.
 */
async function scopeWarnings(settings: SettingsManager, models: ModelRuntimeHost): Promise<StatusIssue[]> {
	const patterns = settings.getEnabledModels();
	if (patterns === undefined || patterns.length === 0) return [];
	const { diagnostics } = await models.scope(patterns);
	return diagnostics.map((diagnostic) => issue("warning", `enabledModels: ${diagnostic.message}`));
}

/** README §11.4: finding out never fails; whatever stops it is an `error` issue and the backend is not usable. */
export async function piStatus(
	models: ModelRuntimeHost,
	agentDir: string,
	extras: StatusExtras,
): Promise<BackendStatus> {
	try {
		return await probe(models, agentDir, extras);
	} catch (error) {
		return {
			installed: true,
			version: VERSION,
			auth: "unknown",
			usable: false,
			issues: [issue("error", `Pi's state could not be read: ${errorText(error)}`)],
		};
	}
}
