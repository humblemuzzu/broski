/**
 * A terminal `pi` for the tests: a real Pi session on the world's faux models, extensions bound the way the interactive
 * mode binds them (for the first session and after every switch, `setRebindSession`; `mode: "tui"`; `abortHandler` doing
 * what the Esc key does: the queue back to the editor, then the abort, pi-coding-agent
 * `src/modes/interactive/interactive-mode.ts:1978-1981, 4711-4725`). Its Broski link extension is the one the bridge
 * installed and Pi's own loader found, and it connects to the world's real link socket.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { TerminalSession } from "../../../backends/pi/terminal/registry";
import { FAUX_MODEL_IDS, FAUX_PROVIDER } from "./faux-models";
import { silentUi } from "./pi-spike";
import type { PiWorld } from "./pi-world";

export interface Terminal {
	readonly session: AgentSession;
	readonly runtime: AgentSessionRuntime;
	/** Where the terminal's session file is, or will be once its first message is written. */
	readonly file: string;
}

export class TerminalRig {
	/** What the terminal's UI was told (`ctx.ui.notify`). */
	readonly notices: string[] = [];
	/** What Esc put back into the terminal's editor, one entry per queued message. */
	readonly restored: string[] = [];
	private readonly runtimes: AgentSessionRuntime[] = [];

	constructor(private readonly t: { readonly world: PiWorld }) {}

	/** A new terminal session of the project, or the session `file` resumed. */
	async open(file?: string, options: { readonly mode?: "tui" | "rpc" } = {}): Promise<Terminal> {
		const { services } = this.t.world.parts;
		const model = services.models.runtime.getModel(FAUX_PROVIDER, FAUX_MODEL_IDS.reasoner);
		if (!model) throw new Error("the world has no faux model");
		const { env } = this.t.world;
		const sessionManager =
			file === undefined ? SessionManager.create(env.cwd, env.sessionDir) : SessionManager.open(file, env.sessionDir);
		const runtime = await createAgentSessionRuntime(
			async ({ cwd, agentDir, sessionManager: manager }) => {
				const created = await createServices(services.models.runtime, cwd, agentDir, manager, model);
				return created;
			},
			{ cwd: env.cwd, agentDir: env.agentDir, sessionManager },
		);
		this.runtimes.push(runtime);
		const bind = (bound: AgentSession) =>
			bound.bindExtensions({
				uiContext: silentUi(this.notices),
				mode: options.mode ?? "tui",
				abortHandler: () => {
					const queued = bound.clearQueue();
					this.restored.push(...queued.steering, ...queued.followUp);
					void bound.abort();
				},
			});
		runtime.setRebindSession(bind);
		const { session } = runtime;
		await bind(session);
		const path = session.sessionManager.getSessionFile();
		if (path === undefined) throw new Error("the terminal session has no file");
		return { session, runtime, file: path };
	}

	/** Resolves once the terminal's UI has been told something. */
	async noticed(): Promise<void> {
		while (this.notices.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
	}

	/** Resolves once the bridge's registry holds the terminal that has `file` open. */
	connected(file: string): Promise<TerminalSession> {
		const registry = this.t.world.parts.terminal.registry;
		const present = registry.session(file);
		if (present) return Promise.resolve(present);
		return new Promise((resolve) => {
			const stop = registry.watch(file, (session) => {
				if (!session) return;
				stop();
				resolve(session);
			});
		});
	}

	/** Resolves once no terminal holds `file` any more. */
	gone(file: string): Promise<void> {
		const registry = this.t.world.parts.terminal.registry;
		if (registry.session(file) === undefined) return Promise.resolve();
		return new Promise((resolve) => {
			const stop = registry.watch(file, (session) => {
				if (session) return;
				stop();
				resolve();
			});
		});
	}

	/** Ends every terminal session, as quitting `pi` does (`session_shutdown`). */
	async quit(): Promise<void> {
		for (const runtime of this.runtimes.splice(0)) await runtime.dispose();
	}
}

async function createServices(
	modelRuntime: Parameters<typeof createAgentSessionServices>[0]["modelRuntime"],
	cwd: string,
	agentDir: string,
	sessionManager: SessionManager,
	model: Model<Api>,
) {
	const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
	const created = await createAgentSessionFromServices({ services, sessionManager, model });
	return { ...created, services, diagnostics: services.diagnostics };
}
