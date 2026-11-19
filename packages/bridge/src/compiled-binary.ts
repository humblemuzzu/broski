/**
 * Whether this process is a `bun build --compile` binary.
 *
 * Compiled binaries mount the bundle on a virtual root (`/$bunfs/`).
 * Comparing `process.execPath` with
 * `process.argv[1]` never detects this: argv[1] is the virtual entry path.
 */

export type CompiledBinaryInput = {
	/** `Bun.isStandaloneExecutable` when the runtime exposes it. */
	standaloneFlag?: unknown;
	metaUrl?: string;
	metaPath?: string;
	bunMain?: string;
	argv1?: string;
	execPath?: string;
};

const BUNFS_SEGMENT = "/$bunfs/";

export function isBunfsPath(value: string | null | undefined): boolean {
	if (!value) return false;
	const withoutScheme = value.startsWith("file://") ? value.slice("file://".length) : value;
	return withoutScheme.includes(BUNFS_SEGMENT);
}

export function detectCompiledBinary(input: CompiledBinaryInput): boolean {
	if (typeof input.standaloneFlag === "boolean") return input.standaloneFlag;
	if (
		isBunfsPath(input.metaUrl) ||
		isBunfsPath(input.metaPath) ||
		isBunfsPath(input.bunMain) ||
		isBunfsPath(input.argv1)
	) {
		return true;
	}
	return Boolean(input.execPath) && input.execPath === input.argv1;
}

let cachedCompiled: boolean | null = null;

export function isCompiledBinary(): boolean {
	if (cachedCompiled === null) {
		cachedCompiled = detectCompiledBinary({
			standaloneFlag: Bun.isStandaloneExecutable,
			metaUrl: import.meta.url,
			metaPath: import.meta.path,
			bunMain: Bun.main,
			argv1: process.argv[1],
			execPath: process.execPath,
		});
	}
	return cachedCompiled;
}
