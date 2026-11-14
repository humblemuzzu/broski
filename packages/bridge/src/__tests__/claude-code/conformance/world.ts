/**
 * One conformance world: a throwaway Claude home, the scripted endpoint routed per session, the CLI under test, and
 * the adapter built over them as production builds it, with an SDK bound to the home (`isolated-sdk.ts`). `restart`
 * disposes the backend and builds another over the same home.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ClaudeCodeFactoryOptions, claudeCodeBackendFactory } from "../../../backends/claude-code/factory";
import type { AgentBackend, BackendHost } from "../../../contract";
import { EXPECTED_CLAUDE_CLI_VERSION } from "../../../server/claude-code-backend";
import { type ClaudeHome, claudeTestEnv, createClaudeHome, README_TEXT } from "../../helpers/claude-home";
import { type ScriptedAnthropic, serveScriptedAnthropic } from "../../helpers/scripted-anthropic-server";
import { isolatedClaudeSdk } from "../helpers/isolated-sdk";
import { testClaudeBinary } from "../helpers/test-claude-cli";
import { installElicitServer } from "./elicit-server";
import { ModelEcho } from "./model-echo";
import { Activity, type Observed, observe } from "./observed-backend";
import { SessionRouter } from "./session-router";
import { type HoldSeam, TerminalAsks } from "./terminal-asks";

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

	static async create(host: BackendHost, seam?: HoldSeam): Promise<ClaudeWorld> {
		const home = createClaudeHome();
		const router = new SessionRouter();
		const server = serveScriptedAnthropic([], { routes: router.routes() });
		const cliPath = testClaudeBinary();
		prepareHome(home);
		const terminalAsks = new TerminalAsks(seam);
		const env = claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl });
		const options: ClaudeCodeFactoryOptions = {
			cli: { found: true, path: cliPath },
			env,
			stateDir: join(home.root, "broski-state"),
			clientApp: "broski/conformance",
			expectedCliVersion: EXPECTED_CLAUDE_CLI_VERSION,
			terminal: { hookAsks: terminalAsks.hookAsks },
		};
		const activity = new Activity();
		const observed = observe(await claudeCodeBackendFactory(withSdk(options))(host), activity);
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
		this.observed = observe(await claudeCodeBackendFactory(withSdk(this.options))(host), this.activity);
		return this.observed.backend;
	}

	/** Every request stayed on the scripted endpoint. */
	escapes(): string[] {
		return this.server.escapes();
	}

	async dispose(): Promise<void> {
		await this.terminalAsks.dispose();
		this.server.stop();
		this.home.cleanup();
	}
}

/** Each backend gets an SDK of its own, which its `dispose` ends. */
function withSdk(options: ClaudeCodeFactoryOptions): ClaudeCodeFactoryOptions {
	return { ...options, sdk: isolatedClaudeSdk(options.env) };
}

/** The elicitation server (form, url, confirm) and a project command to list. */
function prepareHome(home: ClaudeHome): void {
	installElicitServer(home.root, home.configDir);
	const project = join(home.projectDir, ".claude");
	mkdirSync(join(project, "commands"), { recursive: true });
	writeFileSync(join(project, "commands", "conformance.md"), "Reply with the word CONFORMANCE. $ARGUMENTS\n");
}
