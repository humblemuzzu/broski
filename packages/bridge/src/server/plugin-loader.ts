/**
 * The third-party adapters the config names (`adapters`), as backend factories for the core. Each module is imported
 * when its backend starts, beside the others: one that fails to import, exports no `createBroskiAdapter` or throws
 * fails that backend's start, which the core's registry logs and names to every request for it, and nothing else. An
 * id already taken, by a built-in backend or an earlier entry, is refused, so a plugin never stands in for another.
 */

import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AdapterEntry } from "../config/schema";
import type { BackendFactory, BackendId } from "../contract";
import type { ImageFitter } from "../platform/image-fit";
import type { BroskiAdapterPlugin, BroskiPluginContext } from "../plugin";
import type { BroskiMcpIssuer } from "./bridge-mcp";

export interface PluginHost {
	/** Read when a plugin's backend starts, by then the login shell's. */
	readonly env: () => Readonly<Record<string, string>>;
	readonly mcp: (backend: BackendId) => BroskiMcpIssuer;
	readonly phoneWriting: string | undefined;
	readonly fitImage: ImageFitter;
	/** Each adapter's `stateDir` is `<stateRoot>/<id>`: `~/.broski/adapters` in production. */
	readonly stateRoot: string;
	readonly log: (message: string) => void;
}

export function loadConfiguredAdapters(
	entries: readonly AdapterEntry[],
	taken: readonly BackendId[],
	host: PluginHost,
): Array<readonly [BackendId, BackendFactory]> {
	const ids = new Set(taken);
	const loaded: Array<readonly [BackendId, BackendFactory]> = [];
	for (const entry of entries) {
		if (!entry.enabled) continue;
		if (ids.has(entry.id)) {
			host.log(`[plugins] ${entry.module} is not loaded: the backend id ${entry.id} is already taken`);
			continue;
		}
		ids.add(entry.id);
		loaded.push([entry.id, pluginFactory(entry, host)]);
	}
	return loaded;
}

function pluginFactory(entry: AdapterEntry, host: PluginHost): BackendFactory {
	return async (backendHost) => {
		const plugin = await importPlugin(entry.module);
		const factory = factoryOf(plugin, await contextOf(entry, host), entry.module);
		return factory(backendHost);
	};
}

function factoryOf(plugin: BroskiAdapterPlugin, ctx: BroskiPluginContext, module: string): BackendFactory {
	let factory: BackendFactory;
	try {
		factory = plugin(ctx);
	} catch (error) {
		throw new Error(`createBroskiAdapter of ${module} threw: ${messageOf(error)}`);
	}
	if (typeof factory !== "function") throw new Error(`createBroskiAdapter of ${module} returned no backend factory`);
	return factory;
}

async function importPlugin(module: string): Promise<BroskiAdapterPlugin> {
	if (module.startsWith(".")) {
		throw new Error(`the plugin module ${module} is a relative path; give an absolute path or a package name`);
	}
	let loaded: unknown;
	try {
		loaded = await import(isAbsolute(module) ? pathToFileURL(module).href : module);
	} catch (error) {
		throw new Error(`the plugin module ${module} failed to load: ${messageOf(error)}`);
	}
	if (!isPluginModule(loaded)) throw new Error(`the plugin module ${module} exports no createBroskiAdapter function`);
	return loaded.createBroskiAdapter;
}

function isPluginModule(value: unknown): value is { readonly createBroskiAdapter: BroskiAdapterPlugin } {
	return (
		typeof value === "object" &&
		value !== null &&
		"createBroskiAdapter" in value &&
		typeof value.createBroskiAdapter === "function"
	);
}

async function contextOf(entry: AdapterEntry, host: PluginHost): Promise<BroskiPluginContext> {
	const stateDir = join(host.stateRoot, entry.id);
	await mkdir(stateDir, { recursive: true, mode: 0o700 });
	return {
		id: entry.id,
		config: entry.config ?? {},
		env: host.env(),
		mcp: host.mcp(entry.id),
		phoneWriting: host.phoneWriting,
		fitImage: host.fitImage,
		stateDir,
		log: (message) => host.log(`[plugin ${entry.id}] ${message}`),
	};
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
