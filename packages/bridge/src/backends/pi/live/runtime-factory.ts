/**
 * One `AgentSessionRuntime` per hosted session (D1). Its factory rebuilds the cwd-bound services
 * (settings, resource loader) around the process's one `ModelRuntime`, which it always passes on:
 * omitted, `createAgentSessionServices` would build a second one (pi-coding-agent `src/core/agent-session-services.ts`).
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type InlineExtension,
	type ModelRuntime,
	type ResolveModelScopeResult,
	type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { withoutPackageInstalls } from "../no-package-installs";
import { sessionSettingsOf } from "../project-settings";
import { isBroskiLink } from "../terminal/install";
import { scopedStart } from "./scoped-start";

export interface SharedServices {
	readonly agentDir: string;
	readonly modelRuntime: ModelRuntime;
	/** `enabledModels` resolved against the runtime (`models/model-runtime.ts`, `scope`). */
	readonly scope: (patterns: readonly string[]) => Promise<ResolveModelScopeResult>;
}

export interface RuntimeTarget {
	readonly cwd: string;
	readonly sessionManager: SessionManager;
	/** For a new session; an existing one restores its own from the branch (`src/core/sdk.ts:220-232`). */
	readonly model?: Model<Api>;
	readonly thinkingLevel?: ThinkingLevel;
	readonly extensions: readonly InlineExtension[];
}

export interface HostedRuntime {
	readonly runtime: AgentSessionRuntime;
	/** The configured packages the load left out because they are not installed (`no-package-installs.ts`). */
	readonly missingPackages: readonly string[];
	/** What is wrong with the cwd's `enabledModels`, which the terminal prints as it starts. */
	readonly scopeWarnings: readonly string[];
}

export async function createHostedRuntime(shared: SharedServices, target: RuntimeTarget): Promise<HostedRuntime> {
	let missingPackages: readonly string[] = [];
	let scopeWarnings: readonly string[] = [];
	const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
		const settingsManager = sessionSettingsOf(cwd, agentDir);
		const loaded = await withoutPackageInstalls({ cwd, agentDir, settingsManager }, () =>
			createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime: shared.modelRuntime,
				settingsManager,
				resourceLoaderOptions: {
					extensionFactories: [...target.extensions],
					extensionsOverride: (loaded) => ({
						...loaded,
						extensions: loaded.extensions.filter((extension) => !isBroskiLink(agentDir, extension.path)),
					}),
				},
			}),
		);
		const services = loaded.value;
		missingPackages = loaded.missing;
		const isNew = sessionManager.buildSessionContext().messages.length === 0;
		const scoped = await scopedStart(settingsManager, shared.modelRuntime, shared.scope, isNew);
		scopeWarnings = scoped.warnings;
		const model = target.model ?? scoped.start?.model;
		const thinkingLevel = target.model === undefined ? scoped.start?.thinkingLevel : target.thinkingLevel;
		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			...(model !== undefined && { model }),
			...(thinkingLevel !== undefined && { thinkingLevel }),
			...(scoped.scopedModels.length > 0 && { scopedModels: [...scoped.scopedModels] }),
			...(sessionStartEvent !== undefined && { sessionStartEvent }),
		});
		return { ...created, services, diagnostics: services.diagnostics };
	};
	const runtime = await createAgentSessionRuntime(factory, {
		cwd: target.cwd,
		agentDir: shared.agentDir,
		sessionManager: target.sessionManager,
	});
	return { runtime, missingPackages, scopeWarnings };
}
