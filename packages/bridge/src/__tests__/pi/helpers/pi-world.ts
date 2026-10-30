/**
 * Everything one Pi test lives in: a throwaway home (`createPiTestEnv`), the driver's extension and
 * prompt template written into its agent dir, the faux models on the adapter's own `ModelRuntime`,
 * the scripted router, and the real backend `createPiBackend` builds (its parts and `piBackendOf`) over them. A
 * restart builds a new backend over the same directories, as a restarted bridge would.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FauxProviderHandle } from "@earendil-works/pi-ai";
import { createPiParts, type PiParts, piBackendOf } from "../../../backends/pi/backend";
import { createPiServices, type PiServices } from "../../../backends/pi/services";
import type { AgentBackend, BackendHost, SessionControl, SessionId } from "../../../contract";
import { Activity } from "./activity";
import { type DriverBus, installDriverBus, removeDriverBus } from "./driver-bus";
import { type FakeTrash, installFakeTrash } from "./fake-trash";
import { FAUX_MODEL_IDS, FAUX_PROVIDER, registerDriverFaux } from "./faux-models";
import { FauxRouter, REQUEST_CAP_MESSAGE } from "./faux-router";
import { type ObservedBackend, observeOpens } from "./observed-backend";
import { createPiTestEnv, type PiTestEnv } from "./pi-test-env";

/** The prompt template the driver writes: a command whose expansion starts with this marker. */
export const TEMPLATE_NAME = "drv-template";
export const TEMPLATE_MARKER = `[[${TEMPLATE_NAME}]]`;

export interface PiWorldOptions {
	/** Merged over the driver's `settings.json`; `compaction` and `retry` replace the defaults whole. */
	readonly settings?: Readonly<Record<string, unknown>>;
	/**
	 * Where Pi writes session files: the environment variable the test env sets (default), the
	 * `sessionDir` setting, or Pi's own default under the agent dir. Pi's precedence is that order.
	 */
	readonly sessionsAt?: "env" | "setting" | "default";
}

const SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

/** A throwaway home with the driver's files, bus and fake trash; nothing in it hosts a session yet. */
export interface Home {
	readonly env: PiTestEnv;
	readonly bus: DriverBus;
	readonly trash: FakeTrash;
	readonly sessionsRoot: string;
}

export function createHome(options: PiWorldOptions = {}): Home {
	const env = createPiTestEnv();
	try {
		const bus = installDriverBus();
		const trash = installFakeTrash(env);
		return { env, bus, trash, sessionsRoot: writeAgentFiles(env, options) };
	} catch (error) {
		removeDriverBus();
		env.dispose();
		throw error;
	}
}

export class PiWorld {
	private constructor(
		readonly env: PiTestEnv,
		/** The directory session files are found under. */
		readonly sessionsRoot: string,
		/** Where a deleted session goes. */
		readonly trash: FakeTrash,
		readonly bus: DriverBus,
		readonly activity: Activity,
		private running: Running,
	) {}

	get backend(): AgentBackend {
		return this.running.observed.backend;
	}

	/** The parts of the running backend, for a test that checks what the contract does not show. */
	get parts(): PiParts {
		return this.running.parts;
	}

	get router(): FauxRouter {
		return this.running.router;
	}

	/** The control of the view the backend last opened on `sessionId`. */
	controlOf(sessionId: SessionId): SessionControl | undefined {
		return this.running.observed.controlOf(sessionId);
	}

	static async create(host: BackendHost, options: PiWorldOptions = {}): Promise<PiWorld> {
		const { env, bus, trash, sessionsRoot } = createHome(options);
		try {
			const activity = new Activity();
			const owner: { world?: PiWorld } = {};
			const running = await startBackend(host, env, activity, () => owner.world?.halt());
			owner.world = new PiWorld(env, sessionsRoot, trash, bus, activity, running);
			return owner.world;
		} catch (error) {
			removeDriverBus();
			env.dispose();
			throw error;
		}
	}

	/** Disposes the running backend and starts a new one over the same directories. */
	async restart(host: BackendHost): Promise<AgentBackend> {
		await this.backend.dispose();
		this.running = await startBackend(host, this.env, this.activity, () => this.halt());
		return this.backend;
	}

	/** Fails the test that is running instead of letting it loop: the backend stops, and `assertNotCapped` says why. */
	assertNotCapped(): void {
		if (this.router.capped) throw new Error(REQUEST_CAP_MESSAGE);
	}

	private halt(): void {
		void this.backend.dispose();
	}

	/** Removes the directories and puts the environment back; the backend is disposed by whoever made it. */
	dispose(): void {
		removeDriverBus();
		this.env.dispose();
	}
}

/** The shared services over the env's agent dir, the faux models on their `ModelRuntime`, and the router answering them. */
export interface FauxStack {
	readonly services: PiServices;
	readonly faux: FauxProviderHandle;
	readonly router: FauxRouter;
}

export async function startFauxStack(
	env: PiTestEnv,
	activity: Activity,
	onCap: () => void = () => {},
): Promise<FauxStack> {
	const services = await createPiServices({ agentDir: env.agentDir });
	const faux = await registerDriverFaux(services.models.runtime);
	return { services, faux, router: new FauxRouter(faux, activity, onCap) };
}

interface Running {
	readonly parts: PiParts;
	readonly observed: ObservedBackend;
	readonly router: FauxRouter;
}

async function startBackend(
	host: BackendHost,
	env: PiTestEnv,
	activity: Activity,
	onCap: () => void,
): Promise<Running> {
	const { services, router } = await startFauxStack(env, activity, onCap);
	const parts = createPiParts(host, services);
	return { parts, observed: observeOpens(piBackendOf(parts)), router };
}

/** The driver's `settings.json`, extension reference and prompt template, written into the env's agent dir. Returns where session files will be. */
export function writeAgentFiles(env: PiTestEnv, options: PiWorldOptions = {}): string {
	const sessionsAt = options.sessionsAt ?? "env";
	const bySetting = join(env.root, "sessions-by-setting");
	const settings = {
		defaultProvider: FAUX_PROVIDER,
		defaultModel: FAUX_MODEL_IDS.reasoner,
		retry: { baseDelayMs: 1 },
		compaction: { keepRecentTokens: 1 },
		extensions: [join(import.meta.dir, "driver-extension.ts")],
		...(sessionsAt === "setting" && { sessionDir: bySetting }),
		...options.settings,
	};
	if (sessionsAt !== "env") delete process.env[SESSION_DIR_ENV];
	writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify(settings, null, 2));
	mkdirSync(join(env.agentDir, "prompts"), { recursive: true });
	writeFileSync(
		join(env.agentDir, "prompts", `${TEMPLATE_NAME}.md`),
		`---\ndescription: The conformance driver's template\n---\n${TEMPLATE_MARKER} $ARGUMENTS\n`,
	);
	return { env: env.sessionDir, setting: bySetting, default: join(env.agentDir, "sessions") }[sessionsAt];
}
