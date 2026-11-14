/** The catalogue over the real bundled CLI, a throwaway Claude home and the scripted endpoint . */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../../backends/claude-code/catalog-feed";
import { createCatalogue } from "../../../backends/claude-code/models/catalog";
import type { CatalogueAccess } from "../../../backends/claude-code/ports/catalogue";
import type { QueryParams } from "../../../backends/claude-code/ports/sdk";
import { type ClaudeCodeServices, createClaudeCodeServices } from "../../../backends/claude-code/services";
import type { CatalogEvent } from "../../../contract";
import { type ClaudeHome, claudeTestEnv, createClaudeHome } from "../../helpers/claude-home";
import { type ScriptedAnthropic, serveScriptedAnthropic } from "../../helpers/scripted-anthropic-server";
import { isolatedClaudeSdk } from "../helpers/isolated-sdk";
import { testClaudeBinary } from "../helpers/test-claude-cli";

export const CLI_TEST_MS = 60_000;

export interface RealWorldOptions {
	readonly signedOut?: boolean;
	readonly env?: Readonly<Record<string, string>>;
	readonly expectedCliVersion?: string;
	/** Another binary than the tests' own, for a spawn failure. */
	readonly cliPath?: string;
}

export interface RealWorld {
	readonly home: ClaudeHome;
	readonly server: ScriptedAnthropic;
	readonly services: ClaudeCodeServices;
	readonly catalogue: CatalogueAccess;
	readonly events: CatalogEvent[];
	/** Every `query()` the catalogue started, with the options it gave it. */
	readonly started: QueryParams[];
	/** A second catalogue over the same state dir and CLI, as after a bridge restart. */
	restart(): CatalogueAccess;
	stop(): Promise<void>;
	/** The CLI binary and the environment it is started with. */
	readonly cliPath: string;
	readonly env: Readonly<Record<string, string>>;
}

export function writeProjectCommand(home: ClaudeHome, name: string, body: string): void {
	const dir = join(home.projectDir, ".claude", "commands");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${name}.md`), body);
}

export function writeProjectSettings(home: ClaudeHome, settings: object): void {
	const dir = join(home.projectDir, ".claude");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
}

export function writeProjectSkill(home: ClaudeHome, name: string, description: string): void {
	const dir = join(home.projectDir, ".claude", "skills", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nDo the ${name} thing.\n`);
}

export function startRealWorld(options: RealWorldOptions = {}, prepare?: (home: ClaudeHome) => void): RealWorld {
	const home = createClaudeHome();
	prepare?.(home);
	const server = serveScriptedAnthropic([], {});
	const base: Record<string, string> = { ...claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl }) };
	if (options.signedOut) delete base.ANTHROPIC_API_KEY;
	const env = { ...base, ...options.env };
	const cliPath = options.cliPath ?? testClaudeBinary();
	const sdk = isolatedClaudeSdk(env);
	const started: QueryParams[] = [];
	const counting = {
		...sdk,
		query: (params: QueryParams) => {
			started.push(params);
			return sdk.query(params);
		},
	};
	const services = createClaudeCodeServices({
		cli: { found: true, path: cliPath },
		env,
		stateDir: join(home.root, "broski-state"),
		clientApp: "broski/test",
		expectedCliVersion: options.expectedCliVersion,
		sdk: counting,
	});
	const events: CatalogEvent[] = [];
	const make = () => createCatalogue({ services, catalog: new CatalogFeed({ emit: (event) => events.push(event) }) });
	return {
		home,
		server,
		cliPath,
		env,
		services,
		catalogue: make(),
		events,
		started,
		restart: make,
		stop: async () => {
			await sdk.dispose();
			server.stop();
			home.cleanup();
		},
	};
}
