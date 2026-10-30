/**
 * A Pi test home hosted straight on the SDK (no adapter), for the tests that pin what the driver
 * relies on: the same agent-dir files, faux stack and driver extension the adapter's world uses.
 */

import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionUIContext,
	type InlineExtension,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Activity } from "./activity";
import { type DriverBus, removeDriverBus } from "./driver-bus";
import { FAUX_MODEL_IDS } from "./faux-models";
import { hostSpikeSession, silentUi, spikeRuntimeFactory } from "./pi-spike";
import type { PiTestEnv } from "./pi-test-env";
import { createHome, type FauxStack, type PiWorldOptions, startFauxStack } from "./pi-world";

export interface HostOptions {
	readonly modelId?: string;
	readonly ui?: Partial<ExtensionUIContext>;
	/** Added to the driver's own extension, as the adapter adds its built-in and hidden ones. */
	readonly extensions?: InlineExtension[];
}

export class SdkRig {
	readonly env: PiTestEnv;
	readonly bus: DriverBus;
	readonly activity = new Activity();
	private readonly runtimes: AgentSessionRuntime[] = [];

	constructor(options: PiWorldOptions = {}) {
		({ env: this.env, bus: this.bus } = createHome(options));
	}

	stack(): Promise<FauxStack> {
		return startFauxStack(this.env, this.activity);
	}

	/** A new session of the env's project, bound to `ui` (default: every dialog answered with Pi's default). */
	async host(stack: FauxStack, options: HostOptions = {}): Promise<AgentSession> {
		const modelId = options.modelId ?? FAUX_MODEL_IDS.reasoner;
		const model = stack.faux.getModel(modelId);
		if (!model) throw new Error(`no faux model ${modelId}`);
		const factory = spikeRuntimeFactory(stack.services.models.runtime, model, options.extensions ?? []);
		const runtime = await hostSpikeSession(this.env, factory);
		this.runtimes.push(runtime);
		await runtime.session.bindExtensions({ uiContext: { ...silentUi(), ...options.ui }, mode: "rpc" });
		return runtime.session;
	}

	/** The session file `file` hosted again, as a new process would host it. */
	async reopen(stack: FauxStack, file: string, modelId: string = FAUX_MODEL_IDS.reasoner): Promise<AgentSession> {
		const model = stack.faux.getModel(modelId);
		if (!model) throw new Error(`no faux model ${modelId}`);
		const runtime = await createAgentSessionRuntime(
			async ({ cwd, agentDir, sessionManager }) => {
				const services = await createAgentSessionServices({
					cwd,
					agentDir,
					modelRuntime: stack.services.models.runtime,
				});
				const created = await createAgentSessionFromServices({ services, sessionManager, model });
				return { ...created, services, diagnostics: services.diagnostics };
			},
			{
				cwd: this.env.cwd,
				agentDir: this.env.agentDir,
				sessionManager: SessionManager.open(file, this.env.sessionDir),
			},
		);
		this.runtimes.push(runtime);
		await runtime.session.bindExtensions({ uiContext: silentUi(), mode: "rpc" });
		return runtime.session;
	}

	/** Disposes every hosted session, running the extensions' `session_shutdown` handlers. */
	async endSessions(): Promise<void> {
		for (const runtime of this.runtimes.splice(0)) await runtime.dispose();
	}

	async dispose(): Promise<void> {
		await this.endSessions();
		removeDriverBus();
		this.env.dispose();
	}
}

export function recordEvents(session: AgentSession): AgentSessionEvent[] {
	const events: AgentSessionEvent[] = [];
	session.subscribe((event) => events.push(event));
	return events;
}
