/**
 * One live test's world: its temp folders (`broski-agy-live-…`, removed with the world), the wire tap the backend runs
 * as its `agy`, and the production Antigravity backends it starts over them, each behind the account's guard
 * (`guard.ts`). The backend gets what the bridge gives it in production (`server/contract-backends.ts`) except that
 * its folder for `agy` is a temp one and its `agy` is the tap: the user's real `agy` (`BROSKI_TEST_AGY_CLI`, else the
 * one on `PATH`), their real sign-in, and agy's real presence-lock folder, which the backend takes locks in by design.
 * Nothing here writes to `~/.broski`, `~/.pi` or `~/.claude`, or to agy's settings.
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import packageMeta from "../../../../package.json";
import { antigravityBackendFactory } from "../../../backends/antigravity/factory";
import { presenceDirOf } from "../../../backends/antigravity/install";
import type {
	AgentBackend,
	BackendHost,
	CatalogEvent,
	NewSessionOptions,
	OpenTarget,
	SessionRef,
} from "../../../contract";
import { CatalogRecorder, LiveSession, SessionRecorder } from "../../../contract/testing/conformance-harness";
import { fileLock } from "../../../platform/file-lock";
import { fitImageBase64 } from "../../../platform/image-fit";
import { bridgeEnv } from "../../../platform/shell-env";
import { resolveAgyCli } from "../../../server/antigravity-cli-path";
import { tempDirectory } from "../../helpers/workspace-rig";
import { account } from "./account";
import { TURN_MS } from "./gate";
import { type Guarded, type GuardOptions, guardBackend } from "./guard";
import { type CheapChoice, cheapChoice } from "./model";
import { WireLog } from "./wire-log";

const README = "The magic word is pelican.\n";

export interface WorldOptions {
	/** What the world's prompts are counted under. */
	readonly label: string;
	/** The folder new sessions run in; a temp one (with `README.md`) unless named. */
	readonly cwd?: string;
	readonly phoneNote?: string;
}

export interface StartOptions {
	readonly maxSessions?: number;
	/** A host that is told the catalog's events too (a conformance rule's). */
	readonly host?: BackendHost;
	readonly rewrite?: GuardOptions["rewrite"];
	readonly emitted?: GuardOptions["emitted"];
}

/** A started backend: the guarded one the tests use, the catalog its host records, and the world's folder. */
export class LiveBackend {
	constructor(
		readonly guarded: Guarded,
		readonly catalog: CatalogRecorder,
		readonly choice: CheapChoice,
		private readonly cwd: string,
	) {}

	get backend(): AgentBackend {
		return this.guarded.backend;
	}

	openNew(options: Partial<NewSessionOptions> = {}): Promise<LiveSession> {
		return this.opened({ kind: "new", options: { cwd: this.cwd, ...options } });
	}

	open(session: SessionRef): Promise<LiveSession> {
		return this.opened({ kind: "existing", session });
	}

	private async opened(target: OpenTarget): Promise<LiveSession> {
		const recorder = new SessionRecorder(TURN_MS);
		const opened = await this.backend.open(target, recorder);
		if (opened.status === "rejected") {
			throw new Error(`open was rejected: ${opened.rejection.code} ${opened.rejection.message}`);
		}
		return new LiveSession(opened.session, opened.snapshot, recorder, this.backend.traits);
	}
}

export class AgyWorld {
	/** What the backends logged of what agy sent that broke the protocol. */
	readonly faults: string[] = [];
	private readonly started: LiveBackend[] = [];

	private constructor(
		readonly options: WorldOptions,
		readonly agy: string,
		readonly root: string,
		readonly cwd: string,
		readonly otherCwd: string,
		readonly tap: WireLog,
		private readonly cliPath: string,
		private readonly ownsCwd: boolean,
	) {}

	static create(options: WorldOptions): AgyWorld {
		account.claim();
		const cli = resolveAgyCli(process.env.BROSKI_TEST_AGY_CLI);
		if (!cli.found) throw new Error(`the live tests need the user's agy: ${cli.reason}`);
		const root = tempDirectory("broski-agy-live-");
		const cwd = options.cwd ?? tempDirectory("broski-agy-live-");
		if (options.cwd === undefined) writeFileSync(join(cwd, "README.md"), README);
		const otherCwd = tempDirectory("broski-agy-live-other-");
		const { log, cliPath } = WireLog.install(root, cli.path);
		return new AgyWorld(options, cli.path, root, cwd, otherCwd, log, cliPath, options.cwd === undefined);
	}

	get voidDir(): string {
		return join(this.root, "void");
	}

	get presenceDir(): string {
		return presenceDirOf(bridgeEnv());
	}

	/** The world's own folders: the ones agy may act in, and the ones it removes. */
	get roots(): string[] {
		return [this.root, this.otherCwd, ...(this.ownsCwd ? [this.cwd] : [])];
	}

	/** A production backend over this world's folders and tap, as the bridge would start it. */
	async start(options: StartOptions = {}): Promise<LiveBackend> {
		const catalog = new CatalogRecorder(TURN_MS);
		const { host } = options;
		const sink = {
			emit: (event: CatalogEvent) => {
				catalog.emit(event);
				host?.catalog.emit(event);
			},
		};
		const raw = await antigravityBackendFactory({
			install: {
				cli: { found: true, path: this.cliPath },
				env: bridgeEnv(),
				voidDir: this.voidDir,
				presenceDir: this.presenceDir,
				...(this.options.phoneNote !== undefined && { phoneNote: this.options.phoneNote }),
			},
			bridgeVersion: packageMeta.version,
			fileLock,
			fitImage: fitImageBase64,
			...(options.maxSessions !== undefined && { maxSessions: options.maxSessions }),
			log: (message) => this.faults.push(message),
		})({ catalog: sink });
		const choice = await cheapChoice(raw, this.cwd).catch(async (error: unknown) => {
			await raw.dispose();
			throw error;
		});
		const guarded = guardBackend(raw, {
			label: this.options.label,
			account,
			choice,
			roots: this.roots,
			...(options.rewrite !== undefined && { rewrite: options.rewrite }),
			...(options.emitted !== undefined && { emitted: options.emitted }),
		});
		const live = new LiveBackend(guarded, catalog, choice, this.cwd);
		this.started.push(live);
		return live;
	}

	/** Every backend disposed (each `dispose` is idempotent), then the temp folders removed. */
	async dispose(): Promise<void> {
		for (const live of this.started.splice(0)) await live.backend.dispose();
		for (const dir of this.roots) rmSync(dir, { recursive: true, force: true });
	}
}
