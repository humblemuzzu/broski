import { dirname, join, relative, resolve, sep } from "node:path";
import { importSites } from "./import-scan";

export interface SourceFile {
	readonly path: string;
	readonly source: string;
}

/** The SDK packages each directory under `src/backends` may import, by directory name. */
const BACKEND_SDKS = new Map<string, readonly string[]>([
	["claude-code", ["@anthropic-ai/claude-agent-sdk"]],
	["codex", []],
	["opencode", ["@opencode/client"]],
	["pi", ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core"]],
	["pi-durable", ["@earendil-works/pi-durable", "@earendil-works/chord", "@earendil-works/pi-ai"]],
	["pi-shared", ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"]],
]);

/**
 * Directories several adapters share, and who may import them. Pi Durable runs on Pi's model
 * runtime (pd D9), so the code both use lives once, under `backends/pi-shared/`.
 */
const SHARED_DIRS = new Map<string, readonly string[]>([["pi-shared", ["pi", "pi-durable"]]]);

/** `createRequire` hands out a `require` this check cannot follow. */
const LOADERS = new Set(["module", "node:module"]);

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Every import in `files` that breaks the bridge's layers (contract README §2, Hard rules), as
 * `path: problem`. `src` is the bridge's `src` directory; only files under `src/contract` and
 * `src/backends` are judged.
 *
 * - `src/contract/` is a leaf: it imports only zod and itself; its `testing/` may also import bun:test.
 * - `src/backends/<id>/` imports only the contract (not its test kit), itself, a shared directory
 *   made for it, `node:` built-ins and that backend's own SDK.
 * - Every specifier is a plain string, so the check sees what is loaded.
 */
export function layerViolations(src: string, files: readonly SourceFile[]): string[] {
	const layout = {
		contract: join(src, "contract"),
		testing: join(src, "contract", "testing"),
		backends: join(src, "backends"),
	};
	return files.flatMap((file) => problemsOf(file, layout).map((problem) => `${relative(src, file.path)}: ${problem}`));
}

type Layout = { contract: string; testing: string; backends: string };
type Judge = (specifier: string | undefined) => string[];

function problemsOf(file: SourceFile, layout: Layout): string[] {
	if (within(file.path, layout.contract)) return specifiersOf(file).flatMap(contractJudge(file, layout));
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

function backendJudge(file: SourceFile, id: string, sdks: readonly string[], layout: Layout): Judge {
	const reachable = [join(layout.backends, id), ...sharedFor(id).map((shared) => join(layout.backends, shared))];
	return (specifier) => {
		if (specifier === undefined) return ["an import whose specifier is not a plain string"];
		if (specifier.startsWith(".")) {
			const target = resolve(dirname(file.path), specifier);
			const allowed =
				reachable.some((dir) => within(target, dir)) ||
				(within(target, layout.contract) && !within(target, layout.testing));
			return allowed ? [] : [`${specifier} is neither this backend nor the contract`];
		}
		if (LOADERS.has(specifier)) return [`${specifier} loads modules this check cannot see`];
		if (specifier.startsWith("node:") || sdks.some((sdk) => isPackage(specifier, sdk))) return [];
		return [`${specifier} is not this backend's SDK`];
	};
}

function sharedFor(id: string): string[] {
	return [...SHARED_DIRS].flatMap(([shared, users]) => (users.includes(id) ? [shared] : []));
}

function within(path: string, dir: string): boolean {
	return path === dir || path.startsWith(dir + sep);
}

function isPackage(specifier: string, name: string): boolean {
	return specifier === name || specifier.startsWith(`${name}/`);
}
