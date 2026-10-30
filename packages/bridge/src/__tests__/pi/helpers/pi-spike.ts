/**
 * The construction the Pi adapter hosts a session with (D1),
 * reduced to what the SDK spike tests need: one shared `ModelRuntime` with the faux provider, an
 * `AgentSessionRuntime` whose services are rebuilt around it, and a UI context that answers nothing.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionUIContext,
	type InlineExtension,
	type ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { plainTheme } from "../../../backends/pi/ui/plain-theme";
import type { PiTestEnv } from "./pi-test-env";

export function spikeRuntimeFactory(
	modelRuntime: ModelRuntime,
	model: Model<Api>,
	extensions: InlineExtension[],
): CreateAgentSessionRuntimeFactory {
	return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			modelRuntime,
			resourceLoaderOptions: { extensionFactories: extensions },
		});
		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			model,
			...(sessionStartEvent !== undefined && { sessionStartEvent }),
		});
		return { ...created, services, diagnostics: services.diagnostics };
	};
}

/** A new session of `env.cwd`, written to `env.sessionDir`. */
export function hostSpikeSession(
	env: PiTestEnv,
	factory: CreateAgentSessionRuntimeFactory,
): Promise<AgentSessionRuntime> {
	return createAgentSessionRuntime(factory, {
		cwd: env.cwd,
		agentDir: env.agentDir,
		sessionManager: SessionManager.create(env.cwd, env.sessionDir),
	});
}

/** Dialogs answer Pi's defaults at once; `notify` texts are recorded. */
export function silentUi(notices: string[] = []): ExtensionUIContext {
	return {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		notify: (message) => notices.push(message),
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => {
			throw new Error("custom() cannot reach a phone");
		},
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: plainTheme(),
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "themes are not shown on a phone" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}
