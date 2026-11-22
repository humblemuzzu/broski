import { dirname, join, relative, resolve, sep } from "node:path";
import { BACKEND_ID_PATTERN } from "../../src/contract/ids";
import { type ImportSite, importSites } from "./import-scan";

export interface SourceFile {
	readonly path: string;
	readonly source: string;
}

/** The SDK packages each directory under `src/backends` may import, by directory name; one not listed imports none. */
const BACKEND_SDKS = new Map<string, readonly string[]>([["claude-code", ["@anthropic-ai/claude-agent-sdk"]]]);

/**
 * Code a backend writes out for its agent to load (a directory named `extension` in its tree): it runs inside the
 * user's agent, so it may import that agent's packages, which the agent provides, `node:` built-ins and its own
 * directory, and nothing else. The rest of the backend reads it only as text (`with { type: "text" }`).
 */
const AGENT_EXTENSION_PACKAGES = new Map<string, readonly string[]>([
	["pi", ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"]],
]);
const EXTENSION_DIRECTORY = "extension";

/** `createRequire` hands out a `require` this check cannot follow. */
const LOADERS = new Set(["module", "node:module"]);

/**
 * The generic infrastructure `src/core/` may use, by path under `src` without its extension: the
 * bounded map, and the frame-size measure of the send limits. These are judged too, so the core
 * cannot reach anything through them: they import nothing but zod and each other.
 */
export const CORE_INFRASTRUCTURE: readonly string[] = ["state/bounded-map", "transport/send-limits"];

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Every import in `files` that breaks the bridge's layers (contract README §2, Hard rules), as
 * `path: problem`. `src` is the bridge's `src` directory; only files under `src/contract`,
 * `src/core`, `src/adapter-kit` and `src/backends`, and the `CORE_INFRASTRUCTURE` modules, are judged.
 *
 * - `src/contract/` is a leaf: it imports only zod and itself; its `testing/` may also import bun:test.
 * - `src/core/` imports only itself, the contract (not its test kit), zod and `CORE_INFRASTRUCTURE`:
 *   never a connector, handler, runtime mapper, adapter, `node:` module or the server. It reaches
 *   adapters only through the `AgentBackend` values its registry holds.
 * - A `CORE_INFRASTRUCTURE` module imports only zod and the other such modules.
 * - `src/adapter-kit/`, what adapters share, imports only itself, the contract (not its test kit), zod and `node:`
 *   built-ins: never the core, the server or any backend's SDK.
 * - `src/backends/<id>/`, `<id>` a `BackendId`, imports only the contract (not its test kit), the adapter kit, itself,
 *   `node:` built-ins, zod (to check what a backend reads from a process it talks to) and that backend's own SDK; an
 *   `extension/` directory in it only as text.
 * - An `extension/` directory under `src/backends/<id>/` imports only itself, `node:` built-ins and its agent's packages.
 * - Every specifier is a plain string, so the check sees what is loaded.
 */
export function layerViolations(src: string, files: readonly SourceFile[]): string[] {
	const layout = {
		src,
		contract: join(src, "contract"),
		testing: join(src, "contract", "testing"),
		core: join(src, "core"),
		adapterKit: join(src, "adapter-kit"),
		backends: join(src, "backends"),
	};
	return files.flatMap((file) => problemsOf(file, layout).map((problem) => `${relative(src, file.path)}: ${problem}`));
}

type Layout = { src: string; contract: string; testing: string; core: string; adapterKit: string; backends: string };
type Judge = (specifier: string | undefined) => string[];

function problemsOf(file: SourceFile, layout: Layout): string[] {
	if (within(file.path, layout.contract)) return specifiersOf(file).flatMap(contractJudge(file, layout));
	if (within(file.path, layout.core)) return specifiersOf(file).flatMap(coreJudge(file, layout));
	if (within(file.path, layout.adapterKit)) return specifiersOf(file).flatMap(adapterKitJudge(file, layout));
	if (infrastructureOf(layout).has(withoutExtension(file.path))) {
		return specifiersOf(file).flatMap(infrastructureJudge(file, layout));
	}
	if (!within(file.path, layout.backends)) return [];
	const [id = ""] = relative(layout.backends, file.path).split(sep);
	if (!BACKEND_ID_PATTERN.test(id)) return [`${id} is not a backend id directory`];
	const sdks = BACKEND_SDKS.get(id) ?? [];
	const extension = extensionDirectoryOf(file.path, layout.backends);
	if (extension !== undefined) {
		return specifiersOf(file).flatMap(extensionJudge(file, extension, AGENT_EXTENSION_PACKAGES.get(id) ?? []));
	}
	const sites = importSites(file.source);
	return specifiersOf(file).flatMap((specifier) => backendJudge(file, id, sdks, layout, sites)(specifier));
}

/** Every specifier the file loads; undefined for one it computes. */
function specifiersOf(file: SourceFile): (string | undefined)[] {
	const ours = importSites(file.source).map((site) => site.specifier);
	const bun = transpiler.scanImports(file.source).map((entry) => entry.path);
	return [...new Set([...ours, ...bun])];
}

/** The `extension/` directory under `backends` that `path` lies in, the innermost; undefined outside one. */
function extensionDirectoryOf(path: string, backends: string): string | undefined {
	if (!within(path, backends)) return undefined;
	const parts = relative(backends, dirname(path)).split(sep);
	const at = parts.lastIndexOf(EXTENSION_DIRECTORY);
	return at < 0 ? undefined : join(backends, ...parts.slice(0, at + 1));
}

function extensionJudge(file: SourceFile, extension: string, packages: readonly string[]): Judge {
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			return within(resolve(dirname(file.path), specifier), extension) ? [] : [`${specifier} leaves the extension`];
		}
		if (specifier.startsWith("node:") && !LOADERS.has(specifier)) return [];
		return packages.some((name) => isPackage(specifier, name)) ? [] : [`${specifier} is not the agent's package`];
	};
}

function contractJudge(file: SourceFile, layout: Layout): Judge {
	const testing = within(file.path, layout.testing);
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			return within(resolve(dirname(file.path), specifier), layout.contract)
				? []
				: [`${specifier} leaves src/contract`];
		}
		if (isPackage(specifier, "zod") || (testing && specifier === "bun:test")) return [];
		return [`${specifier} is not zod`];
	};
}

function coreJudge(file: SourceFile, layout: Layout): Judge {
	const infrastructure = infrastructureOf(layout);
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			const target = resolve(dirname(file.path), specifier);
			const allowed =
				within(target, layout.core) || inContract(target, layout) || infrastructure.has(withoutExtension(target));
			return allowed ? [] : [`${specifier} is neither the core, the contract nor the core's infrastructure`];
		}
		return isPackage(specifier, "zod") ? [] : [`${specifier} is not zod`];
	};
}

function adapterKitJudge(file: SourceFile, layout: Layout): Judge {
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			const target = resolve(dirname(file.path), specifier);
			const allowed = within(target, layout.adapterKit) || inContract(target, layout);
			return allowed ? [] : [`${specifier} is neither the adapter kit nor the contract`];
		}
		if (LOADERS.has(specifier)) return [`${specifier} loads modules this check cannot see`];
		return specifier.startsWith("node:") || isPackage(specifier, "zod") ? [] : [`${specifier} is not zod or node`];
	};
}

function infrastructureJudge(file: SourceFile, layout: Layout): Judge {
	const infrastructure = infrastructureOf(layout);
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			return infrastructure.has(withoutExtension(resolve(dirname(file.path), specifier)))
				? []
				: [`${specifier} is not the core's infrastructure, which the core reaches through this file`];
		}
		return isPackage(specifier, "zod") ? [] : [`${specifier} is not zod`];
	};
}

/** The paths of `CORE_INFRASTRUCTURE`, absolute and without extension. */
function infrastructureOf(layout: Layout): Set<string> {
	return new Set(CORE_INFRASTRUCTURE.map((path) => join(layout.src, path)));
}

function withoutExtension(path: string): string {
	return path.replace(/\.ts$/, "");
}

function backendJudge(
	file: SourceFile,
	id: string,
	sdks: readonly string[],
	layout: Layout,
	sites: readonly ImportSite[],
): Judge {
	const own = join(layout.backends, id);
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			const target = resolve(dirname(file.path), specifier);
			const allowed = within(target, own) || within(target, layout.adapterKit) || inContract(target, layout);
			if (!allowed) return [`${specifier} is neither this backend, the adapter kit nor the contract`];
			const asText =
				sites.some((site) => site.specifier === specifier) &&
				sites.every((site) => site.specifier !== specifier || site.asText === true);
			const agentCode = extensionDirectoryOf(target, layout.backends) !== undefined;
			return !agentCode || asText ? [] : [`${specifier} is agent code, read only as text`];
		}
		if (LOADERS.has(specifier)) return [`${specifier} loads modules this check cannot see`];
		if (specifier.startsWith("node:") || isPackage(specifier, "zod") || sdks.some((sdk) => isPackage(specifier, sdk))) {
			return [];
		}
		return [`${specifier} is not this backend's SDK`];
	};
}

/** In the contract, outside its test kit. */
function inContract(path: string, layout: Layout): boolean {
	return within(path, layout.contract) && !within(path, layout.testing);
}

function within(path: string, dir: string): boolean {
	return path === dir || path.startsWith(dir + sep);
}

function isPackage(specifier: string, name: string): boolean {
	return specifier === name || specifier.startsWith(`${name}/`);
}
