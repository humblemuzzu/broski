/**
 * Pi's configuration files in the agent dir, watched so that a `/login` or a `models.json` edit made in a terminal
 * reaches the phones as `catalog_invalidated{models}` and a fresh `status_changed` (contract README §5, catalog sink).
 * A missed event costs a stale list until the next one: the status and model list re-read the files when asked.
 */

import { type FSWatcher, watch } from "node:fs";
import type { BackendStatus, CatalogScope } from "../../contract";
import type { CatalogFeed } from "./catalog-feed";
import { isDirectory } from "./is-directory";
import { isFileSystemError } from "./store/open-file";

/** What the model list and the status read (`models/model-runtime.ts`, `status.ts`); the settings name commands too. */
const SCOPES: ReadonlyMap<string, readonly CatalogScope[]> = new Map([
	["auth.json", ["models"]],
	["models.json", ["models"]],
	["models-store.json", ["models"]],
	["settings.json", ["models", "commands"]],
]);
const DEBOUNCE_MS = 300;

export class ConfigWatch {
	private watcher: FSWatcher | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly changed = new Set<CatalogScope>();
	private stopped = false;

	constructor(
		private readonly agentDir: string,
		private readonly catalog: CatalogFeed,
		private readonly status: () => Promise<BackendStatus>,
	) {}

	/** Watches the agent dir when it exists and is not watched yet. */
	attach(): void {
		if (this.stopped || this.watcher !== undefined || !isDirectory(this.agentDir)) return;
		try {
			const watcher = watch(this.agentDir, { persistent: false }, (_event, filename) => {
				const scopes = filename === null ? (["models", "commands"] as const) : SCOPES.get(filename);
				if (scopes !== undefined) this.schedule(scopes);
			});
			watcher.on("error", () => {
				watcher.close();
				if (this.watcher === watcher) this.watcher = undefined;
			});
			this.watcher = watcher;
		} catch (error) {
			if (!isFileSystemError(error)) throw error;
		}
	}

	stop(): void {
		this.stopped = true;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.watcher?.close();
		this.watcher = undefined;
	}

	private schedule(scopes: readonly CatalogScope[]): void {
		for (const scope of scopes) this.changed.add(scope);
		this.timer ??= setTimeout(() => {
			this.timer = undefined;
			void this.announce();
		}, DEBOUNCE_MS);
	}

	private async announce(): Promise<void> {
		if (this.stopped) return;
		const scopes = [...this.changed];
		this.changed.clear();
		for (const scope of scopes) this.catalog.emit({ type: "catalog_invalidated", scope });
		if (!scopes.includes("models")) return;
		const status = await this.status();
		if (!this.stopped) this.catalog.emit({ type: "status_changed", status });
	}
}
