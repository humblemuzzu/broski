/** Lane C · the `CatalogueAccess` `backend.ts` builds: `initialize` answers by cwd, cached (D6), and what they list. */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import type {
	BackendStatus,
	CommandsListResult,
	ModelId,
	ModelSummary,
	ModelsListResult,
	ModesListResult,
	Rejected,
} from "../../../contract";
import { commandsOf } from "../commands";
import { permissionsAxis } from "../modes";
import type { CatalogueAccess } from "../ports/catalogue";
import type { CatalogueDeps } from "../ports/deps";
import { type ProbeOutcome, probeInitialize } from "../process/probe";
import { isRejected, rejected } from "../rejections";
import type { ClaudeCodeServices } from "../services";
import { claudeCodeStatus, type StatusSource } from "../status";
import { CatalogCache, type CatalogEntry } from "./catalog-cache";
import { listedModelIdOf, modelSummaries } from "./model-list";
import { failureCode, failureText } from "./startup-failures";

/** A status reuses the newest answer this young; older, it asks the CLI again, so a sign-in shows within a minute. */
export const STATUS_FRESH_MS = 60_000;

const CATALOG_SCOPES = ["models", "commands", "modes"] as const;

type Probed = { readonly kind: "answered"; readonly entry: CatalogEntry } | Extract<ProbeOutcome, { kind: "failed" }>;

class Catalogue implements CatalogueAccess {
	private readonly cache: CatalogCache;
	private readonly inflight = new Map<string, Promise<Probed>>();
	private generation = 0;
	private latest: { readonly at: number; readonly init: SDKControlInitializeResponse } | undefined;

	constructor(
		private readonly services: ClaudeCodeServices,
		private readonly feed: CatalogueDeps["catalog"],
	) {
		this.cache = new CatalogCache({
			path: join(services.stateDir, "catalog.json"),
			cliPath: services.cli.found ? services.cli.path : "",
			now: () => services.clock.now(),
		});
	}

	initialize(cwd: string): Promise<SDKControlInitializeResponse | Rejected> {
		return this.read(async () => {
			const entry = await this.entryFor(cwd, false);
			return isRejected(entry) ? entry : entry.init;
		});
	}

	observe(cwd: string, init: SDKControlInitializeResponse): void {
		this.latest = { at: this.services.clock.now(), init };
		void this.cache.refresh(cwd, init);
	}

	invalidate(cwd?: string): void {
		this.generation += 1;
		this.inflight.clear();
		if (cwd === undefined) this.latest = undefined;
		void this.cache.drop(cwd);
		for (const scope of CATALOG_SCOPES) this.feed.emit({ type: "catalog_invalidated", scope });
	}

	models(cwd: string | undefined): Promise<ModelsListResult> {
		return this.read(async () => {
			const entry = await this.entryFor(cwd, false);
			return isRejected(entry) ? entry : { status: "accepted", models: modelSummaries(entry.init.models) };
		});
	}

	commands(cwd: string | undefined): Promise<CommandsListResult> {
		return this.read(async () => {
			const entry = await this.entryFor(cwd, true);
			if (isRejected(entry)) return entry;
			return {
				status: "accepted",
				commands: commandsOf(entry.init.commands, new Set(entry.skills)),
			};
		});
	}

	modes(cwd: string | undefined): Promise<ModesListResult> {
		return this.read(async () => {
			const entry = await this.entryFor(cwd, false);
			return isRejected(entry)
				? entry
				: { status: "accepted", modes: [permissionsAxis(entry.init.models, this.services.mayBypassPermissions)] };
		});
	}

	model(cwd: string, modelId: ModelId): Promise<ModelSummary | Rejected | undefined> {
		return this.read(async () => {
			const entry = await this.entryFor(cwd, false);
			return isRejected(entry) ? entry : modelSummaries(entry.init.models).find((model) => model.id === modelId);
		});
	}

	async listedModelId(cwd: string, wireModel: string): Promise<ModelId | undefined> {
		const entry = await this.read(() => this.entryFor(cwd, false));
		return isRejected(entry) ? undefined : listedModelIdOf(entry.init.models, wireModel);
	}

	async status(): Promise<BackendStatus> {
		const { cli, expectedCliVersion } = this.services;
		try {
			const source: StatusSource = cli.found ? await this.statusSource() : { kind: "missing", reason: cli.reason };
			return claudeCodeStatus(source, expectedCliVersion);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return claudeCodeStatus({ kind: "unreadable", installed: cli.found, reason }, expectedCliVersion);
		}
	}

	private async read<T>(work: () => Promise<T | Rejected>): Promise<T | Rejected> {
		try {
			return await work();
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return rejected("backend_error", `the Claude Code catalogue failed: ${reason}`);
		}
	}

	/**
	 * Where a probe runs when no project is named: a folder of ours, never the user's home, whose `.claude` the CLI would
	 * read as a project's own.
	 */
	private async neutralCwd(): Promise<string> {
		await mkdir(this.services.stateDir, { recursive: true, mode: 0o700 }).catch(() => undefined);
		return this.services.stateDir;
	}

	private async statusSource(): Promise<StatusSource> {
		const latest = this.latest;
		if (latest && this.services.clock.now() - latest.at < STATUS_FRESH_MS)
			return { kind: "answered", init: latest.init };
		const probed = await this.probe(await this.neutralCwd());
		return probed.kind === "answered"
			? { kind: "answered", init: probed.entry.init }
			: { kind: "refused", failure: probed.failure };
	}

	private async entryFor(cwd: string | undefined, needSkills: boolean): Promise<CatalogEntry | Rejected> {
		const key = cwd ?? (await this.neutralCwd());
		const cached = await this.cache.get(key);
		if (cached && (!needSkills || cached.skills !== undefined)) return cached;
		const probed = await this.probe(key);
		if (probed.kind === "answered") return probed.entry;
		return cached ?? rejected(failureCode(probed.failure), failureText(probed.failure));
	}

	private probe(key: string): Promise<Probed> {
		const running = this.inflight.get(key);
		if (running) return running;
		const work = this.runProbe(key, this.generation).finally(() => {
			if (this.inflight.get(key) === work) this.inflight.delete(key);
		});
		this.inflight.set(key, work);
		return work;
	}

	private async runProbe(key: string, startedAt: number): Promise<Probed> {
		const outcome = await probeInitialize(this.services, key);
		if (outcome.kind === "failed") return outcome;
		const { init, skills } = outcome.answer;
		const entry: CatalogEntry = { at: this.services.clock.now(), init, skills };
		if (startedAt === this.generation) {
			this.latest = { at: entry.at, init };
			await this.cache.set(key, entry);
		}
		return { kind: "answered", entry };
	}
}

export function createCatalogue(deps: CatalogueDeps): CatalogueAccess {
	return new Catalogue(deps.services, deps.catalog);
}
