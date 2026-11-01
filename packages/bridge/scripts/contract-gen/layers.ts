import { dirname, join, relative, resolve, sep } from "node:path";
import { importSites } from "./import-scan";

export interface SourceFile {
	readonly path: string;
	readonly source: string;
}

/** The SDK packages each directory under `src/backends` may import, by directory name. */
const BACKEND_SDKS = new Map<string, readonly string[]>([
	["claude-code", ["@anthropic-ai/claude-agent-sdk"]],
	["pi", ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core"]],
]);

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
 * `src/core` and `src/backends`, and the `CORE_INFRASTRUCTURE` modules, are judged.
 *
 * - `src/contract/` is a leaf: it imports only zod and itself; its `testing/` may also import bun:test.
 * - `src/core/` imports only itself, the contract (not its test kit), zod and `CORE_INFRASTRUCTURE`:
 *   never a connector, handler, runtime mapper, adapter, `node:` module or the server. It reaches
 *   adapters only through the `AgentBackend` values its registry holds.
 * - A `CORE_INFRASTRUCTURE` module imports only zod and the other such modules.
 * - `src/backends/<id>/` imports only the contract (not its test kit), itself, a shared directory
 *   made for it, `node:` built-ins, zod (to check what a backend reads from a process it talks to) and that backend's own SDK.
 * - Every specifier is a plain string, so the check sees what is loaded.
 */
export function layerViolations(src: string, files: readonly SourceFile[]): string[] {
	const layout = {
		src,
		contract: join(src, "contract"),
		testing: join(src, "contract", "testing"),
		core: join(src, "core"),
		backends: join(src, "backends"),
	};
	return files.flatMap((file) => problemsOf(file, layout).map((problem) => `${relative(src, file.path)}: ${problem}`));
}

type Layout = { src: string; contract: string; testing: string; core: string; backends: string };
type Judge = (specifier: string | undefined) => string[];

function problemsOf(file: SourceFile, layout: Layout): string[] {
	if (within(file.path, layout.contract)) return specifiersOf(file).flatMap(contractJudge(file, layout));
	if (within(file.path, layout.core)) return specifiersOf(file).flatMap(coreJudge(file, layout));
	if (infrastructureOf(layout).has(withoutExtension(file.path))) {
		return specifiersOf(file).flatMap(infrastructureJudge(file, layout));
	}
	if (!within(file.path, layout.backends)) return [];
	const [id = ""] = relative(layout.backends, file.path).split(sep);
	const sdks = BACKEND_SDKS.get(id);
	if (!sdks) return [`${id} is not a backend id directory`];
	return specifiersOf(file).flatMap(backendJudge(file, id, sdks, layout));
}

/** Every specifier the file loads; undefined for one it computes. */
function specifiersOf(file: SourceFile): (string | undefined)[] {
	const ours = importSites(file.source).map((site) => site.specifier);
	const bun = transpiler.scanImports(file.source).map((entry) => entry.path);
	return [...new Set([...ours, ...bun])];
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
				within(target, layout.core) ||
				(within(target, layout.contract) && !within(target, layout.testing)) ||
				infrastructure.has(withoutExtension(target));
			return allowed ? [] : [`${specifier} is neither the core, the contract nor the core's infrastructure`];
		}
		return isPackage(specifier, "zod") ? [] : [`${specifier} is not zod`];
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

function backendJudge(file: SourceFile, id: string, sdks: readonly string[], layout: Layout): Judge {
	const own = join(layout.backends, id);
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			const target = resolve(dirname(file.path), specifier);
			const allowed = within(target, own) || (within(target, layout.contract) && !within(target, layout.testing));
			return allowed ? [] : [`${specifier} is neither this backend nor the contract`];
		}
		if (LOADERS.has(specifier)) return [`${specifier} loads modules this check cannot see`];
		if (specifier.startsWith("node:") || isPackage(specifier, "zod") || sdks.some((sdk) => isPackage(specifier, sdk))) {
			return [];
		}
		return [`${specifier} is not this backend's SDK`];
	};
}

function within(path: string, dir: string): boolean {
	return path === dir || path.startsWith(dir + sep);
}

function isPackage(specifier: string, name: string): boolean {
	return specifier === name || specifier.startsWith(`${name}/`);
}
