/**
 * Lane D's test rigs: `realRig` runs the real CLI against the scripted endpoint in a throwaway home (D32), `fakeRig`
 * runs the host over `FakeQuery`s with a clock the test drives. Both build the registry exactly as `backend.ts` does,
 * with stand-ins for the other lanes' parts.
 */

import { join } from "node:path";
import { CatalogFeed } from "../../../../backends/claude-code/catalog-feed";
import { createLiveSessions } from "../../../../backends/claude-code/live/registry";
import type {
	AskDeskFactory,
	ClaudeSdk,
	Clock,
	CustomToolsPort,
	LiveDeps,
	LiveSessions,
	SessionFunctions,
} from "../../../../backends/claude-code/ports";
import { type ClaudeCodeServices, createClaudeCodeServices } from "../../../../backends/claude-code/services";
import { CLAUDE_CODE_TRAITS } from "../../../../backends/claude-code/traits";
import type { CatalogEvent, OpenTarget, SessionRef } from "../../../../contract";
import { LiveSession, SessionRecorder } from "../../../../contract/testing/conformance-harness";
import { defaultClaudeCliEnvironment, resolveClaudeCliPath } from "../../../../server/claude-cli-path";
import { type ClaudeHome, claudeTestEnv, createClaudeHome } from "../../../helpers/claude-home";
import {
	type ScriptedAnthropic,
	type ScriptedAnthropicOptions,
	type ScriptedTurn,
	serveScriptedAnthropic,
} from "../../../helpers/scripted-anthropic-server";
import { fakeClaudeSdk } from "../../helpers/fake-claude-sdk";
import type { FakeQuery } from "../../helpers/fake-query";
import { ManualClock } from "./manual-clock";
import {
	type StandInCatalogue,
	type StandInDesk,
	type StandInMapping,
	type StandInOwnership,
	type StandInStore,
	standInCatalogue,
	standInDesk,
	standInMapping,
	standInOwnership,
	standInStore,
} from "./stand-ins";

export const OPEN_TIMEOUT_MS = 15_000;

export interface RigOptions {
	readonly mapping?: StandInMapping;
	readonly catalogue?: StandInCatalogue;
	readonly desk?: StandInDesk;
	readonly customTools?: CustomToolsPort;
	readonly createDesk?: AskDeskFactory;
}

export class LiveRig {
	readonly live: LiveSessions;
	readonly catalogEvents: CatalogEvent[] = [];
	/** Sessions a terminal is writing, as `TerminalPresence` reports them. */
	readonly writing = new Set<string>();
	readonly deps: LiveDeps;

	constructor(
		readonly services: ClaudeCodeServices,
		readonly store: StandInStore,
		readonly ownership: StandInOwnership,
		readonly catalogue: StandInCatalogue,
		readonly mapping: StandInMapping,
		readonly desk: StandInDesk,
		private readonly cleanup: () => Promise<void> | void,
	) {
		const catalog = new CatalogFeed({ emit: (event) => this.catalogEvents.push(event) });
		this.deps = {
			services,
			catalog,
			store,
			ownership,
			catalogue,
			terminal: { writing: async (sessionId) => this.writing.has(sessionId) },
			mapping,
			createDesk: desk.factory,
		};
		this.live = createLiveSessions(this.deps);
	}

	/** Opens a session and wraps it as the conformance harness does, so `assertSettled` and `waitFor` are there. */
	async open(target: OpenTarget): Promise<LiveSession> {
		const recorder = new SessionRecorder(OPEN_TIMEOUT_MS);
		const opened = await this.live.open(target, recorder);
		if (opened.status === "rejected") throw new Error(`open was rejected: ${opened.rejection.message}`);
		return new LiveSession(opened.session, opened.snapshot, recorder, CLAUDE_CODE_TRAITS);
	}

	async openNew(
		cwd: string,
		extra: Partial<Extract<OpenTarget, { kind: "new" }>["options"]> = {},
	): Promise<LiveSession> {
		const opened = await this.open({ kind: "new", options: { cwd, ...extra } });
		this.store.known.set(opened.ref.sessionId, { cwd });
		return opened;
	}

	openExisting(session: SessionRef): Promise<LiveSession> {
		return this.open({ kind: "existing", session });
	}

	async dispose(): Promise<void> {
		await this.live.dispose();
		await this.cleanup();
	}
}

function parts(options: RigOptions, sdk: ClaudeSdk) {
	return {
		store: standInStore(sdk),
		ownership: standInOwnership(),
		catalogue: options.catalogue ?? standInCatalogue(),
		mapping: options.mapping ?? standInMapping(),
		desk: options.createDesk ? { ...standInDesk(), factory: options.createDesk } : (options.desk ?? standInDesk()),
	};
}

export interface RealRig extends LiveRig {
	readonly home: ClaudeHome;
	readonly server: ScriptedAnthropic;
	readonly clock: ManualClock;
}

/** The real CLI over a scripted endpoint; a test that never advances `clock` never ends an idle host. */
export function realRig(
	turns: ScriptedTurn[],
	options: RigOptions & { server?: ScriptedAnthropicOptions } = {},
): RealRig {
	const home = createClaudeHome();
	const server = serveScriptedAnthropic(turns, options.server);
	const cli = resolveClaudeCliPath(defaultClaudeCliEnvironment());
	if (!cli.ok) throw new Error(`the live tests need the Claude Code binary: ${cli.reason}`);
	const clock = new ManualClock();
	const services = createClaudeCodeServices({
		cli: { found: true, path: cli.path, source: cli.source },
		configDir: home.configDir,
		env: claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl }),
		stateDir: join(home.root, "broski-state"),
		clientApp: "broski/live-test",
		clock,
		...(options.customTools !== undefined && { customTools: options.customTools }),
	});
	const made = parts(options, services.sdk);
	const rig = new LiveRig(services, made.store, made.ownership, made.catalogue, made.mapping, made.desk, async () => {
		await services.sdk.dispose();
		const escapes = server.escapes();
		server.stop();
		home.cleanup();
		if (escapes.length > 0) throw new Error(`requests escaped the scripted endpoint: ${escapes.join(", ")}`);
	});
	return Object.assign(rig, { home, server, clock });
}

export interface FakeRig extends LiveRig {
	readonly sdk: ReturnType<typeof fakeClaudeSdk>;
	readonly clock: ManualClock;
}

/** The host over `FakeQuery`s: each `query()` call gets the next, and the test pushes its frames. */
export function fakeRig(
	queries: FakeQuery[],
	options: RigOptions & { cli?: boolean; sdk?: Partial<SessionFunctions> } = {},
): FakeRig {
	const sdk = fakeClaudeSdk({ queries, overrides: options.sdk });
	const clock = new ManualClock();
	const services = createClaudeCodeServices({
		cli:
			options.cli === false
				? { found: false, reason: "no binary here" }
				: { found: true, path: "/fake/claude", source: "test" },
		env: { PATH: "/usr/bin" },
		stateDir: "/nonexistent/state",
		clientApp: "broski/fake-test",
		clock,
		sdk,
		...(options.customTools !== undefined && { customTools: options.customTools }),
	});
	const made = parts(options, sdk);
	const rig = new LiveRig(
		services,
		made.store,
		made.ownership,
		made.catalogue,
		made.mapping,
		made.desk,
		() => undefined,
	);
	return Object.assign(rig, { sdk, clock });
}

export type { Clock };
