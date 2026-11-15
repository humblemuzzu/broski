/**
 * Everything one Pi test lives in: a throwaway home (`createPiTestEnv`), the scripted endpoint as the agent dir's
 * custom provider, the driver's extension and prompt template written into the agent dir, a fake `trash`, and the real
 * backend over them running the real `pi` of the devDependency, exactly as production builds it. A restart builds a
 * new backend over the same directories, as a restarted bridge would.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPiParts, type PiParts, piBackendOf } from "../../../backends/pi/backend";
import type { TerminalLinkOptions } from "../../../backends/pi/terminal/link";
import type { AgentBackend, BackendHost, SessionControl, SessionId, SessionSink } from "../../../contract";
import { type ScriptedOpenAI, serveScriptedOpenAI, writeScriptedModels } from "../../helpers/scripted-openai-server";
import { type FakeTrash, installFakeTrash } from "./fake-trash";
import { PiRouter } from "./pi-router";
import { createPiTestEnv, type PiTestEnv } from "./pi-test-env";
import { PROVIDER } from "./scenarios";

/** The `pi` of the devDependency, run as the user's own would be: the executable `bin` npm and bun install. */
export const PI_BIN = resolve(import.meta.dir, "../../../../node_modules/.bin/pi");

/** In listing order. The default model is the second, so a rule that opens the first must really choose it. */
export const MODELS = {
	plain: "scripted-plain",
	reasoner: "scripted-reasoner",
	noOff: "scripted-no-off",
	blind: "scripted-blind",
	tiny: "scripted-tiny",
} as const;

/** The wire id of a scripted model (`${provider}/${id}`). */
export function wireIdOf(modelId: string): string {
	return `${PROVIDER}/${modelId}`;
}

/** A window small enough that one long reply passes Pi's auto-compaction threshold (window − `reserveTokens`). */
export const TINY_CONTEXT_WINDOW = 20_000;

/** The prompt template the driver writes: a command whose expansion starts with this marker. */
export const TEMPLATE_NAME = "drv-template";
export const TEMPLATE_MARKER = `[[${TEMPLATE_NAME}]]`;

export interface PiWorldOptions {
	/** Merged over the world's `settings.json`; `compaction` and `retry` replace the defaults whole. */
	readonly settings?: Readonly<Record<string, unknown>>;
	/**
	 * Where Pi writes session files: the environment variable the test env sets (default), the `sessionDir` setting, or
	 * Pi's own default under the agent dir. Pi's precedence is that order.
	 */
	readonly sessionsAt?: "env" | "setting" | "default";
	/** How many `pi` processes the backend may host at once. */
	readonly maxHosted?: number;
	/** Leave the agent dir with no model at all: a Pi nobody has signed in to a provider. */
	readonly noModels?: boolean;
	/** Start the backend with the link to terminal `pi` processes on, in a directory of the world's own. */
	readonly link?: boolean;
}

/** When the backend last emitted anything, for a `quiesce` that waits on silence, not on a fixed time. */
export class Activity {
	private last = Date.now();

	touch(): void {
		this.last = Date.now();
	}

	/** Resolves once nothing was emitted for `quietMs` and `busy()` is false. */
	async settle(busy: () => boolean, quietMs = 300, limitMs = 20_000): Promise<void> {
		const until = Date.now() + limitMs;
		while (Date.now() < until) {
			if (!busy() && Date.now() - this.last >= quietMs) return;
			await Bun.sleep(25);
		}
	}
}

interface Running {
	readonly parts: PiParts;
	readonly backend: AgentBackend;
}

export class PiWorld {
	readonly activity = new Activity();
	private readonly controls = new Map<SessionId, WeakRef<SessionControl>>();

	private constructor(
		readonly env: PiTestEnv,
		readonly router: PiRouter,
		readonly server: ScriptedOpenAI,
		readonly trash: FakeTrash,
		readonly hostDir: string,
		readonly sessionsRoot: string,
		/** The `pi` the backend runs: the devDependency's, behind a shim that logs each start (`sessionProcesses`). */
		private readonly cli: string,
		private readonly link: TerminalLinkOptions | undefined,
		private readonly maxHosted: number | undefined,
		private running: Running | undefined,
	) {}

	static async create(host: BackendHost, options: PiWorldOptions = {}): Promise<PiWorld> {
		const env = createPiTestEnv();
		const router = new PiRouter();
		const server = serveScriptedOpenAI({ route: router.route, gate: (name) => router.gate(name), note: router.note });
		try {
			process.env.BROSKI_TEST_ENDPOINT = server.origin;
			const sessionsRoot = writeAgentFiles(env, server.url, options);
			const trash = installFakeTrash(env);
			const link = options.link ? linkIn(env) : undefined;
			const cli = writeLaunchLog(env);
			const world = new PiWorld(
				env,
				router,
				server,
				trash,
				join(env.root, "host"),
				sessionsRoot,
				cli,
				link,
				options.maxHosted,
				undefined,
			);
			await world.start(host);
			return world;
		} catch (error) {
			server.stop();
			env.dispose();
			throw error;
		}
	}

	get backend(): AgentBackend {
		if (!this.running) throw new Error("the world's backend has not started");
		return this.running.backend;
	}

	/** The parts of the running backend, for a test that checks what the contract does not show. */
	get parts(): PiParts {
		if (!this.running) throw new Error("the world's backend has not started");
		return this.running.parts;
	}

	/** The control of the view the backend last opened on `sessionId`. */
	controlOf(sessionId: SessionId): SessionControl | undefined {
		return this.controls.get(sessionId)?.deref();
	}

	/** The `pi --mode rpc --session` processes the backend started that are still alive, by their process ids. */
	sessionProcesses(): number {
		return this.launches("--mode rpc --session")
			.map((line) => Number(line.split(" ")[0]))
			.filter(isAlive).length;
	}

	/** How many catalog probes (`pi --mode rpc --no-session`) the backend has started. */
	probes(): number {
		return this.launches("--mode rpc --no-session").length;
	}

	private launches(args: string): string[] {
		const log = launchLogOf(this.env);
		if (!existsSync(log)) return [];
		return readFileSync(log, "utf8")
			.split("\n")
			.filter((line) => line.includes(args));
	}

	/** Disposes the running backend and starts a new one over the same directories. */
	async restart(host: BackendHost): Promise<AgentBackend> {
		await this.backend.dispose();
		await this.start(host);
		return this.backend;
	}

	/** Stops the endpoint, removes the directories and puts the environment back; the backend is disposed by whoever made it. */
	dispose(): void {
		this.server.stop();
		this.env.dispose();
	}

	private async start(host: BackendHost): Promise<void> {
		const parts = createPiParts(host, {
			install: { cli: { found: true, path: this.cli }, env: this.env.env(), agentDir: this.env.agentDir },
			hostDir: this.hostDir,
			...(this.link !== undefined && { link: this.link }),
			...(this.maxHosted !== undefined && { maxHosted: this.maxHosted }),
		});
		await parts.terminal.start();
		this.running = { parts, backend: this.observed(piBackendOf(parts)) };
	}

	/** Methods are copied, never added, so the derived capabilities stay the adapter's. */
	private observed(backend: AgentBackend): AgentBackend {
		const watched = (sink: SessionSink): SessionSink => ({
			emit: (record) => {
				this.activity.touch();
				sink.emit(record);
			},
		});
		return {
			...backend,
			open: async (target, sink) => {
				const opened = await backend.open(target, watched(sink));
				if (opened.status === "accepted" && opened.session.control) {
					this.controls.set(opened.session.session.sessionId, new WeakRef(opened.session.control));
				}
				return opened;
			},
		};
	}
}

const launchLogOf = (env: PiTestEnv) => join(env.root, "pi-launches.log");

/** A shim that logs the process id and arguments of each start, then becomes the real `pi` (same process). */
function writeLaunchLog(env: PiTestEnv): string {
	const shim = join(env.root, "pi-shim");
	writeFileSync(shim, `#!/bin/sh\nprintf '%s %s\\n' "$$" "$*" >> '${launchLogOf(env)}'\nexec '${PI_BIN}' "$@"\n`);
	chmodSync(shim, 0o755);
	return shim;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** The link in a directory of the world's own; the extension finds it through the variable, as it would the user's. */
function linkIn(env: PiTestEnv): TerminalLinkOptions {
	const directory = join(env.root, "link");
	process.env.BROSKI_PI_LINK_DIR = directory;
	return { enabled: true, directory };
}

/**
 * The scripted provider, `settings.json` naming the driver's extension, and the driver's prompt template. Returns where
 * session files will be.
 */
function writeAgentFiles(env: PiTestEnv, url: string, options: PiWorldOptions): string {
	const sessionsAt = options.sessionsAt ?? "env";
	const bySetting = join(env.root, "sessions-by-setting");
	if (!options.noModels)
		writeScriptedModels(env.agentDir, url, PROVIDER, [
			{ id: MODELS.plain, name: "Scripted Plain", reasoning: false, input: ["text", "image"] },
			{ id: MODELS.reasoner, name: "Scripted Reasoner", reasoning: true, input: ["text", "image"] },
			{
				id: MODELS.noOff,
				name: "Scripted No Off",
				reasoning: true,
				input: ["text", "image"],
				thinkingLevelMap: { off: null },
			},
			{ id: MODELS.blind, name: "Scripted Blind", reasoning: false, input: ["text"] },
			{
				id: MODELS.tiny,
				name: "Scripted Tiny",
				reasoning: false,
				input: ["text", "image"],
				contextWindow: TINY_CONTEXT_WINDOW,
			},
		]);
	const settings = {
		defaultProvider: PROVIDER,
		defaultModel: MODELS.reasoner,
		retry: { baseDelayMs: 1 },
		compaction: { keepRecentTokens: 1 },
		extensions: [join(import.meta.dir, "driver-extension.ts")],
		...(sessionsAt === "setting" && { sessionDir: bySetting }),
		...options.settings,
	};
	if (sessionsAt !== "env") delete process.env.PI_CODING_AGENT_SESSION_DIR;
	writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify(settings, null, 2));
	mkdirSync(join(env.agentDir, "prompts"), { recursive: true });
	writeFileSync(
		join(env.agentDir, "prompts", `${TEMPLATE_NAME}.md`),
		`---\ndescription: The conformance driver's template\n---\n${TEMPLATE_MARKER} $ARGUMENTS\n`,
	);
	return { env: env.sessionDir, setting: bySetting, default: join(env.agentDir, "sessions") }[sessionsAt];
}
