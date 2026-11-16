/**
 * A terminal `pi` for the tests: Pi's own interactive session code (the devDependency, in this process) on the world's
 * scripted models, extensions bound the way the interactive
 * mode binds them (for the first session and after every switch, `setRebindSession`; `mode: "tui"`; `abortHandler` doing
 * what the Esc key does: the queue back to the editor, then the abort, pi-coding-agent
 * `src/modes/interactive/interactive-mode.ts:1978-1981, 4711-4725`). Its Broski link extension is the one the bridge
 * installed and Pi's own loader found, and it connects to the world's real link socket.
 */

import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionUIContext,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { TerminalSession } from "../../../backends/pi/terminal/registry";
import { MODELS, type PiWorld } from "./pi-world";
import { plainTheme } from "./plain-theme";
import { PROVIDER } from "./scenarios";

export interface Terminal {
	readonly session: AgentSession;
	readonly runtime: AgentSessionRuntime;
	/** Where the terminal's session file is, or will be once its first message is written. */
	readonly file: string;
}

/** A dialog the terminal shows while a terminal opened with `dialogs: "waiting"` waits for its person. */
export interface ShownDialog {
	readonly title: string;
	/** The person at the terminal answers it. */
	readonly answer: (value: unknown) => void;
	/** Its signal closed it before anyone at the terminal answered. */
	closed: boolean;
}

export class TerminalRig {
	/** What the terminal's UI was told (`ctx.ui.notify`). */
	readonly notices: string[] = [];
	/** The dialogs the terminal showed, oldest first. */
	readonly shown: ShownDialog[] = [];
	/** What Esc put back into the terminal's editor, one entry per queued message. */
	readonly restored: string[] = [];
	private readonly runtimes: AgentSessionRuntime[] = [];

	constructor(private readonly t: { readonly world: PiWorld }) {}

	/**
	 * A new terminal session of the project, or the session `file` resumed. Its dialogs answer nothing at once, unless
	 * `dialogs` is `waiting`: then each waits, as Pi's does, for the person (`shown`) or for its signal.
	 */
	async open(
		file?: string,
		options: { readonly mode?: "tui" | "rpc"; readonly dialogs?: "silent" | "waiting" } = {},
	): Promise<Terminal> {
		const { env } = this.t.world;
		const models = await ModelRuntime.create({
			authPath: join(env.agentDir, "auth.json"),
			modelsPath: join(env.agentDir, "models.json"),
		});
		const model = models.getModel(PROVIDER, MODELS.reasoner);
		if (!model) throw new Error("the world has no scripted model");
		const sessionManager =
			file === undefined ? SessionManager.create(env.cwd, env.sessionDir) : SessionManager.open(file, env.sessionDir);
		const runtime = await createAgentSessionRuntime(
			async ({ cwd, agentDir, sessionManager: manager }) => {
				const created = await createServices(models, cwd, agentDir, manager, model);
				return created;
			},
			{ cwd: env.cwd, agentDir: env.agentDir, sessionManager },
		);
		this.runtimes.push(runtime);
		const bind = (bound: AgentSession) =>
			bound.bindExtensions({
				uiContext: silentUi(this.notices, options.dialogs === "waiting" ? this.shown : undefined),
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

/** A dialog that waits for the person or for `signal`, which resolves it with Pi's default. */
function waiting<T>(shown: ShownDialog[], title: string, fallback: T, signal: AbortSignal | undefined): Promise<T> {
	return new Promise((resolve) => {
		const dialog: ShownDialog = { title, answer: (value) => resolve(value as T), closed: false };
		shown.push(dialog);
		signal?.addEventListener(
			"abort",
			() => {
				dialog.closed = true;
				resolve(fallback);
			},
			{ once: true },
		);
	});
}

/** A UI that keeps what it was told, and whose dialogs answer nothing at once, or wait when `shown` is given. */
function silentUi(notices: string[], shown: ShownDialog[] | undefined): ExtensionUIContext {
	return {
		select: async (title, _options, opts) =>
			shown === undefined ? undefined : waiting<string | undefined>(shown, title, undefined, opts?.signal),
		confirm: async (title, _message, opts) =>
			shown === undefined ? false : waiting(shown, title, false, opts?.signal),
		input: async (title, _placeholder, opts) =>
			shown === undefined ? undefined : waiting<string | undefined>(shown, title, undefined, opts?.signal),
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
			throw new Error("the test terminal draws no custom component");
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
		setTheme: () => ({ success: false, error: "the test terminal keeps its theme" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}

async function createServices(
	modelRuntime: ModelRuntime,
	cwd: string,
	agentDir: string,
	sessionManager: SessionManager,
	model: Model<Api>,
) {
	const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
	const created = await createAgentSessionFromServices({ services, sessionManager, model });
	return { ...created, services, diagnostics: services.diagnostics };
}
