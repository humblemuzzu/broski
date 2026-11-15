/**
 * The catalog of each directory (`probe.ts`), kept while nothing it was read from has changed: a probe starts a `pi`,
 * which runs every extension the user has, and a phone opens its pickers often. A failed probe is not kept.
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { PiInstall } from "../pi-install";
import { type CatalogRead, probeCatalog } from "./probe";

/** A file edited in place changes no directory's stamp, and a sign-in can expire; either is seen after this at the latest. */
const KEEP_MS = 30_000;
const REMEMBERED_CWDS = 16;

/**
 * The sources' stamp is taken once the probe is done, so the files a first `pi` start writes into the agent dir (an
 * empty `auth.json`, `models-store.json`) do not make the next read probe again; a change while the probe runs is seen
 * once `KEEP_MS` has passed. A read in flight is shared.
 */
interface Kept {
	signature: string | undefined;
	readonly at: number;
	readonly read: Promise<CatalogRead>;
}

/** The files and folders Pi reads its models, sign-ins, settings, extensions, templates and skills from. */
const AGENT_SOURCES = [
	"auth.json",
	"models.json",
	"models-store.json",
	"settings.json",
	"trust.json",
	"extensions",
	"prompts",
	"skills",
];
const PROJECT_SOURCES = ["settings.json", "extensions", "prompts", "skills"];

export class PiCatalogs {
	private readonly kept = new Map<string, Kept>();

	constructor(private readonly install: PiInstall) {}

	/** The catalog of a new session in `cwd`; without one, of a session of the agent dir, which holds no project. */
	read(cwd: string | undefined): Promise<CatalogRead> {
		const directory = cwd ?? this.install.agentDir;
		const known = this.kept.get(directory);
		const fresh = known !== undefined && Date.now() - known.at < KEEP_MS;
		if (fresh && (known.signature === undefined || known.signature === this.signature(cwd))) return known.read;
		const read = probeCatalog(this.install, directory);
		const kept: Kept = { signature: undefined, at: Date.now(), read };
		this.kept.delete(directory);
		this.kept.set(directory, kept);
		void read.then((result) => {
			if ("failure" in result) {
				if (this.kept.get(directory) === kept) this.kept.delete(directory);
				return;
			}
			kept.signature = this.signature(cwd);
		});
		for (const oldest of this.kept.keys()) {
			if (this.kept.size <= REMEMBERED_CWDS) break;
			this.kept.delete(oldest);
		}
		return read;
	}

	private signature(cwd: string | undefined): string {
		const agent = resolve(this.install.agentDir);
		const paths = [
			...AGENT_SOURCES.map((name) => join(agent, name)),
			join(this.install.env.HOME || homedir(), ".agents", "skills"),
		];
		if (cwd !== undefined) {
			const project = join(resolve(cwd), ".pi");
			paths.push(
				project,
				...PROJECT_SOURCES.map((name) => join(project, name)),
				join(resolve(cwd), ".agents", "skills"),
			);
		}
		return paths.map(stampOf).join("|");
	}
}

function stampOf(path: string): string {
	try {
		const stats = statSync(path);
		return `${stats.ino}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`;
	} catch {
		return "-";
	}
}
