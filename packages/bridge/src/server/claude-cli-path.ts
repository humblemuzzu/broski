/**
 * Where the `claude` executable is (plan D3). The SDK never looks at `PATH`: without
 * `pathToClaudeCodeExecutable` it `require.resolve`s the optional per-platform package from its own
 * location (`sdk.mjs` `K6`), which a `bun build --compile` binary cannot do. So, in order:
 * 1. the bridge config key `claudeCode.cliPath`, when it names an existing file;
 * 2. in a compiled bridge, the binary the build embedded, extracted with the SDK's `extractFromBunfs()`;
 * 3. otherwise the optional package's binary, found exactly as the SDK finds it.
 * The answer is a value (a path, or why there is none); nothing here throws.
 */

import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extractFromBunfs } from "@anthropic-ai/claude-agent-sdk/extract";
import { isBunfsPath, isCompiledBinary } from "../compiled-binary";
import { embeddedClaudeCli } from "./claude-cli-embedded";

export type ClaudeCliSource = "config" | "embedded" | "package";

export type ClaudeCliPath =
	| { ok: true; path: string; source: ClaudeCliSource; notes: string[] }
	| { ok: false; reason: string; notes: string[] };

export type ClaudeCliEnvironment = {
	configured?: string;
	compiled: boolean;
	embedded: string | null;
	extract: (embeddedPath: string) => string;
	isFile: (path: string) => boolean;
	/** `require.resolve` from the SDK's own location; throws when the package is absent. */
	resolvePackage: (specifier: string) => string;
	platform: NodeJS.Platform;
	arch: string;
	preferMusl: boolean;
};

const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
const CONFIG_HINT = 'set "claudeCode": {"cliPath": "/path/to/claude"} in ~/.broski/config.json';

/** The SDK's candidate list (`sdk.mjs` `K6`): musl first on a musl Linux, `.exe` on Windows. */
export function packageCandidates(platform: NodeJS.Platform, arch: string, preferMusl: boolean): string[] {
	const base = `${SDK_PACKAGE}-`;
	const packages =
		platform === "android"
			? [`${base}linux-${arch}-android`]
			: platform === "linux"
				? preferMusl
					? [`${base}linux-${arch}-musl`, `${base}linux-${arch}`]
					: [`${base}linux-${arch}`, `${base}linux-${arch}-musl`]
				: [`${base}${platform}-${arch}`];
	const suffix = platform === "win32" ? ".exe" : "";
	return packages.map((name) => `${name}/claude${suffix}`);
}

function fromPackage(env: ClaudeCliEnvironment, notes: string[]): ClaudeCliPath {
	const tried = packageCandidates(env.platform, env.arch, env.preferMusl);
	for (const specifier of tried) {
		try {
			const path = env.resolvePackage(specifier);
			if (env.isFile(path)) return { ok: true, path, source: "package", notes };
		} catch {}
	}
	const reason = `no Claude Code binary for ${env.platform}-${env.arch} (looked for ${tried.join(", ")}); reinstall the bridge's dependencies without --omit=optional, or ${CONFIG_HINT}`;
	return { ok: false, reason, notes };
}

function fromEmbedded(env: ClaudeCliEnvironment, notes: string[]): ClaudeCliPath {
	if (env.embedded === null) {
		return { ok: false, reason: `this bridge build carries no Claude Code binary; ${CONFIG_HINT}`, notes };
	}
	const path = env.extract(env.embedded);
	if (isBunfsPath(path) || !env.isFile(path)) {
		const reason = `the bundled Claude Code binary could not be extracted to a real file (got ${path}); ${CONFIG_HINT}`;
		return { ok: false, reason, notes };
	}
	return { ok: true, path, source: "embedded", notes };
}

export function resolveClaudeCliPath(env: ClaudeCliEnvironment): ClaudeCliPath {
	const notes: string[] = [];
	try {
		const configured = env.configured?.trim();
		if (configured) {
			if (env.isFile(configured)) return { ok: true, path: configured, source: "config", notes };
			notes.push(`claudeCode.cliPath ${configured} is not a file; ignored`);
		}
		return env.compiled ? fromEmbedded(env, notes) : fromPackage(env, notes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, reason: `finding the Claude Code binary failed: ${message}`, notes };
	}
}

function isFile(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}

/** The SDK's own musl test (`sdk.mjs` `r3e`): a Linux whose process report names no glibc runtime. */
function runsOnMusl(): boolean {
	if (process.platform !== "linux" || typeof process.report?.getReport !== "function") return false;
	const report: { header?: { glibcVersionRuntime?: string } } = process.report.getReport();
	return report.header?.glibcVersionRuntime === undefined;
}

function resolveFromSdk(specifier: string): string {
	const sdkEntry = createRequire(import.meta.url).resolve(SDK_PACKAGE);
	return createRequire(sdkEntry).resolve(specifier);
}

export function defaultClaudeCliEnvironment(configured?: string): ClaudeCliEnvironment {
	return {
		configured,
		compiled: isCompiledBinary(),
		embedded: embeddedClaudeCli(),
		extract: extractFromBunfs,
		isFile,
		resolvePackage: resolveFromSdk,
		platform: process.platform,
		arch: process.arch,
		preferMusl: runsOnMusl(),
	};
}

/**
 * Resolves on first use and keeps a found path (an extraction reads the whole ~310 MB binary); a miss is
 * resolved again on the next call, so a binary that appears later (or a transient extraction failure) heals.
 */
export function claudeCliPathOnce(
	configured?: string,
	resolve: () => ClaudeCliPath = () => resolveClaudeCliPath(defaultClaudeCliEnvironment(configured)),
): () => ClaudeCliPath {
	let found: ClaudeCliPath | null = null;
	return () => {
		if (found) return found;
		const result = resolve();
		if (result.ok) found = result;
		return result;
	};
}
