import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { type ModelRuntime, resolveModelScopeWithDiagnostics } from "@earendil-works/pi-coding-agent";
import { errorText } from "../error-text";
import { phoneName } from "../phone-text";

export interface AvailableModels {
	/** What the process's runtime can run now (`getAvailableSnapshot`), which the hosted sessions use too. */
	readonly models: readonly Model<Api>[];
	/** Why the latest refresh was not clean. */
	readonly error?: string;
}

/** The files a refresh reads (`ModelRuntime.create`, pi-coding-agent `src/core/model-runtime.ts:205-230`). */
const CONFIG_FILES = ["auth.json", "models.json", "models-store.json"] as const;

type Scope = Awaited<ReturnType<typeof resolveModelScopeWithDiagnostics>>;

/** The global `enabledModels` and a few projects' own. */
const REMEMBERED_SCOPES = 16;

/** `pi update --models` gives up after this long. */
const NETWORK_REFRESH_MS = 15_000;

/** Even with the files unchanged a refresh runs this often, as a credential can expire between two reads. */
const REFRESH_EVERY_MS = 60_000;

/** A refresh names a few providers that failed; past this many the rest are counted. */
const SHOWN_PROBLEMS = 32;

/**
 * The process's one `ModelRuntime`, refreshed as `pi --list-models` refreshes it (`refresh({allowNetwork: false})`)
 * but only when its files changed, `REFRESH_EVERY_MS` passed or the last refresh was not clean: a refresh replaces the
 * runtime's configuration for every hosted session (`src/core/model-runtime.ts:856-863`), and a `models.json` that
 * does not parse loads as no custom providers (`src/core/model-config.ts:168-190`). So a `models.json` caught
 * half-written is not loaded and the runtime keeps the configuration it has; one that parses but breaks Pi's schema
 * is loaded, with its error, as the terminal loads it. Concurrent callers share one refresh.
 */
export class ModelRuntimeHost {
	private inFlight: Promise<AvailableModels> | undefined;
	private lastStamps: string | undefined;
	private lastAt = 0;
	private lastError: string | undefined;
	/** `enabledModels` resolutions since the last refresh: each runs an availability pass of its own. */
	private readonly scopes = new Map<string, Promise<Scope>>();

	constructor(
		readonly runtime: ModelRuntime,
		private readonly agentDir: string,
	) {}

	available(): Promise<AvailableModels> {
		if (this.inFlight === undefined) {
			const started = this.refreshIfStale();
			this.inFlight = started;
			const done = () => {
				this.inFlight = undefined;
			};
			started.then(done, done);
		}
		return this.inFlight;
	}

	/**
	 * What `pi update --models` does (pi-coding-agent `src/package-manager-cli.ts:607-633`): every provider's catalogue
	 * fetched again whatever its age, within `NETWORK_REFRESH_MS`. A provider that fails keeps the catalogue it had, and
	 * is named, on one line of at most `MAX_NAME_CHARS`. The next listing reads every file again.
	 */
	async refreshFromNetwork(): Promise<string[]> {
		await this.available();
		let problems: string[];
		try {
			const { aborted, errors } = await this.runtime.refresh({
				allowNetwork: true,
				force: true,
				signal: AbortSignal.timeout(NETWORK_REFRESH_MS),
			});
			problems = [...errors].map(([providerId, error]) => `${providerId}: ${error.message}`);
			if (aborted) problems.push(`the catalogues were not all fetched within ${NETWORK_REFRESH_MS / 1000} s`);
		} catch (error) {
			problems = [errorText(error)];
		}
		this.lastStamps = undefined;
		this.scopes.clear();
		return shownProblems(problems);
	}

	private async refreshIfStale(): Promise<AvailableModels> {
		const stamps = this.stamps();
		if (stamps !== this.lastStamps || Date.now() - this.lastAt >= REFRESH_EVERY_MS) {
			this.lastError = await this.refresh();
			this.lastStamps = this.lastError === undefined ? stamps : undefined;
			this.lastAt = Date.now();
			this.scopes.clear();
		}
		const models = this.runtime.getAvailableSnapshot();
		return this.lastError === undefined ? { models } : { models, error: this.lastError };
	}

	/**
	 * `resolveModelScopeWithDiagnostics` for `patterns`, as of the latest refresh. The package exports no way to
	 * resolve a scope over a list already read (`resolveModelScopeFromModels` is not exported), so each resolution
	 * reads the availability again (`src/core/model-resolver.ts:403-409`); it is done once per refresh.
	 */
	scope(patterns: readonly string[]): Promise<Scope> {
		const key = JSON.stringify(patterns);
		const known = this.scopes.get(key);
		if (known !== undefined) return known;
		const resolving = resolveModelScopeWithDiagnostics([...patterns], this.runtime);
		if (this.scopes.size >= REMEMBERED_SCOPES) this.scopes.clear();
		this.scopes.set(key, resolving);
		resolving.catch(() => this.scopes.delete(key));
		return resolving;
	}

	/** Undefined when the refresh was clean; a provider's own refresh error keeps its catalogue (pi-ai `dist/models.d.ts:101`). */
	private async refresh(): Promise<string | undefined> {
		const unparsed = this.unparsedModelsFile();
		if (unparsed !== undefined)
			return [unparsed, this.runtime.getError()].filter((reason) => reason !== undefined).join("\n\n");
		const notes: string[] = [];
		try {
			const { errors } = await this.runtime.refresh({ allowNetwork: false });
			for (const [providerId, error] of errors) notes.push(`${providerId}: ${error.message}`);
		} catch (error) {
			notes.push(errorText(error));
		}
		const runtimeError = this.runtime.getError();
		const reasons = runtimeError === undefined ? notes : [runtimeError, ...notes];
		return reasons.length === 0 ? undefined : reasons.join("\n\n");
	}

	private unparsedModelsFile(): string | undefined {
		const path = join(this.agentDir, "models.json");
		let text: string;
		try {
			text = readFileSync(path, "utf-8");
		} catch {
			return undefined;
		}
		try {
			JSON.parse(withoutJsonComments(text.replace(/^\uFEFF/, "")));
			return undefined;
		} catch (error) {
			return `${path} is not valid JSON (${errorText(error)}); the models loaded before it changed stay until it is.`;
		}
	}

	private stamps(): string {
		return CONFIG_FILES.map((name) => {
			try {
				const stats = statSync(join(this.agentDir, name));
				return `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
			} catch {
				return "-";
			}
		}).join("|");
	}
}

/** Pi's `stripJsonComments` (pi-coding-agent `src/utils/json.ts:2-6`), which `ModelConfig.load` parses through and the package does not export. */
function withoutJsonComments(input: string): string {
	return input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ""));
}

function shownProblems(problems: readonly string[]): string[] {
	const shown = problems.slice(0, SHOWN_PROBLEMS).map(phoneName);
	const rest = problems.length - shown.length;
	return rest > 0 ? [...shown, `and ${rest} more`] : shown;
}
