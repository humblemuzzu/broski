/**
 * The commands a resource load found for a cwd, kept while nothing they come from has changed: a load runs every
 * extension's factory, user code with whatever effects it has, and a phone opens its picker often. An edited
 * extension file is not seen again before the process imports another copy anyway (`commands.ts`, `fromLoader`).
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/** A template or skill file edited in place changes no directory's stamp; it is seen after this at the latest. */
const KEEP_MS = 30_000;
const REMEMBERED_CWDS = 16;

interface Kept<T> {
	readonly signature: string;
	readonly at: number;
	readonly value: Promise<T>;
}

export class CommandCache<T> {
	private readonly kept = new Map<string, Kept<T>>();

	constructor(private readonly agentDir: string) {}

	/** `load`'s value for `cwd`, loaded again when a source of commands changed or `KEEP_MS` passed. */
	get(cwd: string | undefined, load: () => Promise<T>): Promise<T> {
		const key = cwd ?? "";
		const signature = this.signature(cwd);
		const known = this.kept.get(key);
		if (known !== undefined && known.signature === signature && Date.now() - known.at < KEEP_MS) return known.value;
		const value = load();
		this.kept.delete(key);
		this.kept.set(key, { signature, at: Date.now(), value });
		value.catch(() => {
			if (this.kept.get(key)?.value === value) this.kept.delete(key);
		});
		for (const oldest of this.kept.keys()) {
			if (this.kept.size <= REMEMBERED_CWDS) break;
			this.kept.delete(oldest);
		}
		return value;
	}

	/** Where Pi finds settings, trust, extensions, templates and skills (`DefaultPackageManager`, `src/core/package-manager.ts`). */
	private signature(cwd: string | undefined): string {
		const agent = resolve(this.agentDir);
		const paths = [
			join(agent, "settings.json"),
			join(agent, "trust.json"),
			join(agent, "extensions"),
			join(agent, "prompts"),
			join(agent, "skills"),
			join(process.env.HOME || homedir(), ".agents", "skills"),
		];
		if (cwd !== undefined) {
			const project = join(resolve(cwd), CONFIG_DIR_NAME);
			paths.push(project, ...["settings.json", "extensions", "prompts", "skills"].map((name) => join(project, name)));
			paths.push(join(resolve(cwd), ".agents", "skills"));
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
