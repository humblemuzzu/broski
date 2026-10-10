import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isCompiledBinary } from "../../compiled-binary";

export const LINK_BINARY_NAME = "broski-link";

const DEV_RELEASE_RELATIVE = join("packages", "link", "target", "release", LINK_BINARY_NAME);
const DEV_SEARCH_DEPTH = 6;

export interface LinkBinaryLookup {
	/** Path to the running broski binary (process.execPath or the dev script) */
	broskiBinaryPath: string;
	/** From `broski install --link-bin` */
	override?: string;
	/** Defaults to isCompiledBinary() */
	compiled?: boolean;
	/** Where a released install lives; defaults to homedir() */
	homeDir?: string;
	/** Directory the dev search walks up from; defaults to the binary dir and cwd */
	searchRoots?: string[];
}

export function resolveLinkBinary(options: LinkBinaryLookup): string {
	if (options.override) {
		const override = resolve(options.override);
		if (!existsSync(override)) throw new Error(`broski-link not found at ${override} (from --link-bin <path>)`);
		return override;
	}

	const candidates = candidatePaths(options);
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(
		`broski-link not found. Looked in:\n${candidates.map((path) => `    ${path}`).join("\n")}\n` +
			"  Build it with: cd packages/link && cargo build --release\n" +
			"  Or install a released build, or point at it with: broski install --link-bin <path>",
	);
}

function candidatePaths(options: LinkBinaryLookup): string[] {
	const candidates: string[] = [];

	candidates.push(resolve(dirname(options.broskiBinaryPath), LINK_BINARY_NAME));
	candidates.push(resolve(options.homeDir ?? homedir(), ".broski", "bin", LINK_BINARY_NAME));

	if (!(options.compiled ?? isCompiledBinary())) {
		for (const root of options.searchRoots ?? [dirname(options.broskiBinaryPath), process.cwd()]) {
			candidates.push(...devCandidates(root));
		}
	}

	return [...new Set(candidates)];
}

function devCandidates(startDir: string): string[] {
	const found: string[] = [];
	let dir = resolve(startDir);
	for (let i = 0; i < DEV_SEARCH_DEPTH; i++) {
		found.push(join(dir, DEV_RELEASE_RELATIVE));
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return found;
}
