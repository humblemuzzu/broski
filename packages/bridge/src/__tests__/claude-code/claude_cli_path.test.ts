import { afterEach, describe, expect, test } from "bun:test";
import { claudeExecutableOption, setClaudeExecutableProvider } from "../../connectors/claude-code/executable";
import { claudeCliCheck } from "../../doctor/checks/claude-cli";
import {
	type ClaudeCliEnvironment,
	defaultClaudeCliEnvironment,
	packageCandidates,
	resolveClaudeCliPath,
} from "../../server/claude-cli-path";
import { devClaudeBinary } from "./spike/rig/processes";

const PKG = "@anthropic-ai/claude-agent-sdk";

function env(overrides: Partial<ClaudeCliEnvironment>): ClaudeCliEnvironment {
	return {
		compiled: false,
		embedded: null,
		extract: (path) => path,
		isFile: () => false,
		resolvePackage: () => {
			throw new Error("not installed");
		},
		platform: "darwin",
		arch: "arm64",
		preferMusl: false,
		...overrides,
	};
}

afterEach(() => setClaudeExecutableProvider(null));

describe("claude executable resolution", () => {
	test("candidates follow the SDK's resolver: musl first on musl Linux, .exe on Windows", () => {
		expect(packageCandidates("darwin", "arm64", false)).toEqual([`${PKG}-darwin-arm64/claude`]);
		expect(packageCandidates("linux", "x64", false)).toEqual([
			`${PKG}-linux-x64/claude`,
			`${PKG}-linux-x64-musl/claude`,
		]);
		expect(packageCandidates("linux", "arm64", true)).toEqual([
			`${PKG}-linux-arm64-musl/claude`,
			`${PKG}-linux-arm64/claude`,
		]);
		expect(packageCandidates("win32", "x64", false)).toEqual([`${PKG}-win32-x64/claude.exe`]);
		expect(packageCandidates("android", "arm64", false)).toEqual([`${PKG}-linux-arm64-android/claude`]);
	});

	test("claudeCode.cliPath wins when it is a file, and is reported and skipped when it is not", () => {
		const isFile = (path: string) => path === "/opt/claude" || path === "/pkg/claude";
		const resolvePackage = () => "/pkg/claude";
		expect(resolveClaudeCliPath(env({ configured: "/opt/claude", isFile, resolvePackage, compiled: true }))).toEqual({
			ok: true,
			path: "/opt/claude",
			source: "config",
			notes: [],
		});
		expect(resolveClaudeCliPath(env({ configured: "/missing/claude", isFile, resolvePackage }))).toEqual({
			ok: true,
			path: "/pkg/claude",
			source: "package",
			notes: ["claudeCode.cliPath /missing/claude is not a file; ignored"],
		});
	});

	test("dev: the first candidate that resolves to a file; otherwise a reason naming what was tried", () => {
		const resolved = resolveClaudeCliPath(
			env({
				platform: "linux",
				arch: "x64",
				resolvePackage: (specifier) => {
					if (specifier.endsWith("-musl/claude")) return "/nm/musl/claude";
					throw new Error("absent");
				},
				isFile: (path) => path === "/nm/musl/claude",
			}),
		);
		expect(resolved).toMatchObject({ ok: true, path: "/nm/musl/claude", source: "package" });
		const missing = resolveClaudeCliPath(env({}));
		expect(missing.ok).toBe(false);
		expect(!missing.ok && missing.reason).toContain(`${PKG}-darwin-arm64/claude`);
		expect(!missing.ok && missing.reason).toContain("claudeCode");
	});

	test("compiled: the embedded binary is extracted; a build without one, or a failed extraction, is a reason", () => {
		const isFile = (path: string) => path === "/tmp/claude-agent-sdk-501/x/claude";
		const extract = (path: string) => (path.includes("good") ? "/tmp/claude-agent-sdk-501/x/claude" : path);
		const extracted = resolveClaudeCliPath(
			env({ compiled: true, embedded: "/$bunfs/root/good/claude", extract, isFile }),
		);
		expect(extracted).toMatchObject({ ok: true, source: "embedded", path: "/tmp/claude-agent-sdk-501/x/claude" });
		const none = resolveClaudeCliPath(env({ compiled: true, resolvePackage: () => "/pkg/claude", isFile: () => true }));
		expect(none).toMatchObject({ ok: false, reason: expect.stringContaining("carries no Claude Code binary") });
		const failed = resolveClaudeCliPath(env({ compiled: true, embedded: "/$bunfs/root/bad/claude", extract, isFile }));
		expect(failed).toMatchObject({ ok: false, reason: expect.stringContaining("could not be extracted") });
	});

	test("never throws: a failing step becomes a reason", () => {
		const thrown = resolveClaudeCliPath(
			env({
				compiled: true,
				embedded: "/$bunfs/root/claude",
				extract: () => {
					throw new Error("disk full");
				},
			}),
		);
		expect(thrown).toEqual({ ok: false, reason: "finding the Claude Code binary failed: disk full", notes: [] });
	});

	test("in this checkout the default environment finds the optional package's binary, as the SDK would", () => {
		expect(resolveClaudeCliPath(defaultClaudeCliEnvironment())).toEqual({
			ok: true,
			path: devClaudeBinary(),
			source: "package",
			notes: [],
		});
	});
});

describe("the old connector's executable option", () => {
	test("absent without a provider; the path with one; the reason as an error when there is no binary", () => {
		expect(claudeExecutableOption()).toEqual({});
		setClaudeExecutableProvider(() => ({ ok: true, path: "/x/claude", source: "package", notes: [] }));
		expect(claudeExecutableOption()).toEqual({ pathToClaudeCodeExecutable: "/x/claude" });
		setClaudeExecutableProvider(() => ({ ok: false, reason: "no binary here", notes: [] }));
		expect(() => claudeExecutableOption()).toThrow("Claude Code is not available: no binary here");
	});
});

describe("doctor", () => {
	test("reports the binary, where it came from and its version", () => {
		const check = claudeCliCheck({ ok: true, path: devClaudeBinary(), source: "package", notes: [] });
		expect(check).toMatchObject({ id: "claude_code", status: "ok" });
		expect(check.message).toMatch(/^Claude Code 2\.1\.316 \(SDK package: .+\/claude\)$/);
	});

	test("warns with the reason when there is no binary or it does not run", () => {
		expect(claudeCliCheck({ ok: false, reason: "none", notes: [] })).toMatchObject({
			status: "warning",
			details: ["none"],
		});
		for (const path of ["/usr/bin/false", "/nonexistent/claude"]) {
			const broken = claudeCliCheck({ ok: true, path, source: "config", notes: [] });
			expect(broken).toMatchObject({ status: "warning", message: expect.stringContaining("does not run") });
		}
	});
});
