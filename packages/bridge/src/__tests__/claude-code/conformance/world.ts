/**
 * One conformance world: a throwaway Claude home (D27), the scripted endpoint routed per session, the real CLI from
 * the optional package, and the adapter built over them exactly as production builds it, with an explicit config dir
 * (D36). `restart` disposes the backend and builds another over the same home.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ClaudeCodeFactoryOptions, claudeCodeBackendFactory } from "../../../backends/claude-code/factory";
import type { AgentBackend, BackendHost } from "../../../contract";
import { type ClaudeHome, claudeTestEnv, createClaudeHome, README_TEXT } from "../../helpers/claude-home";
import { type ScriptedAnthropic, serveScriptedAnthropic } from "../../helpers/scripted-anthropic-server";
import { testClaudeBinary } from "../helpers/test-claude-cli";
import { installElicitServer } from "./elicit-server";
import { ModelEcho } from "./model-echo";
import { Activity, type Observed, observe } from "./observed-backend";
import { SessionRouter } from "./session-router";
import { TerminalAsks } from "./terminal-asks";
import { worldCustomTools } from "./world-custom-tools";

export const CLI_VERSION = "2.1.316";

interface WorldParts {
	readonly home: ClaudeHome;
	readonly server: ScriptedAnthropic;
	readonly router: SessionRouter;
	readonly activity: Activity;
	readonly options: ClaudeCodeFactoryOptions;
	readonly observed: Observed;
	readonly cliPath: string;
	readonly terminalAsks: TerminalAsks;
}

export class ClaudeWorld {
	readonly home: ClaudeHome;
	readonly server: ScriptedAnthropic;
	readonly router: SessionRouter;
	readonly activity: Activity;
	readonly otherCwd: string;
	readonly models: ModelEcho;
	readonly terminalAsks: TerminalAsks;
	readonly cliPath: string;
	private readonly options: ClaudeCodeFactoryOptions;
	private observed: Observed;

	private constructor(parts: WorldParts) {
		const { home, options } = parts;
		this.home = home;
		this.server = parts.server;
		this.router = parts.router;
		this.activity = parts.activity;
		this.options = options;
		this.observed = parts.observed;
		this.terminalAsks = parts.terminalAsks;
		this.cliPath = parts.cliPath;
		this.otherCwd = realpathSync(mkdtempSync(join(home.root, "other-")));
		writeFileSync(join(this.otherCwd, "README.md"), README_TEXT);
		this.models = new ModelEcho(parts.cliPath, home.projectDir, { ...options.env });
	}

	static async create(host: BackendHost): Promise<ClaudeWorld> {
		const home = createClaudeHome();
		const router = new SessionRouter();
		const server = serveScriptedAnthropic([], { routes: router.routes() });
		const cliPath = testClaudeBinary();
		prepareHome(home);
		const terminalAsks = new TerminalAsks();
		const options: ClaudeCodeFactoryOptions = {
			cli: { found: true, path: cliPath },
			configDir: home.configDir,
			env: claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl }),
			stateDir: join(home.root, "broski-state"),
			clientApp: "broski/conformance",
			expectedCliVersion: CLI_VERSION,
			customTools: worldCustomTools(home.homeDir),
			terminal: { hookAsks: terminalAsks.hookAsks },
		};
		const activity = new Activity();
		const observed = observe(await claudeCodeBackendFactory(options)(host), activity);
		return new ClaudeWorld({ home, server, router, activity, options, observed, cliPath, terminalAsks });
	}

	get backend(): AgentBackend {
		return this.observed.backend;
	}

	get env(): Readonly<Record<string, string>> {
		return this.options.env;
	}

	controlOf(sessionId: string) {
		return this.observed.controls.get(sessionId);
	}

	async restart(host: BackendHost): Promise<AgentBackend> {
		await this.observed.backend.dispose();
		this.observed = observe(await claudeCodeBackendFactory(this.options)(host), this.activity);
		return this.observed.backend;
	}

	/** Every request stayed on the scripted endpoint (D32). */
	escapes(): string[] {
		return this.server.escapes();
	}

	async dispose(): Promise<void> {
		await this.terminalAsks.dispose();
		this.server.stop();
		this.home.cleanup();
	}
}

/** The elicitation server (form, url, confirm), a project settings file for `config_file`, a command to list. */
function prepareHome(home: ClaudeHome): void {
	installElicitServer(home.root, home.configDir);
	const project = join(home.projectDir, ".claude");
	mkdirSync(join(project, "commands"), { recursive: true });
	writeFileSync(join(project, "settings.json"), `${JSON.stringify({ permissions: { allow: [] } }, null, 2)}\n`);
	writeFileSync(join(project, "commands", "conformance.md"), "Reply with the word CONFORMANCE. $ARGUMENTS\n");
}
