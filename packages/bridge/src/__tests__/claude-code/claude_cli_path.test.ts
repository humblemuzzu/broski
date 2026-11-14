import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCliCheck } from "../../doctor/checks/claude-cli";
import {
	type ClaudeCliEnvironment,
	defaultClaudeCliEnvironment,
	resolveClaudeCliPath,
} from "../../server/claude-cli-path";
import { testClaudeBinary } from "./helpers/test-claude-cli";

function env(overrides: Partial<ClaudeCliEnvironment>): ClaudeCliEnvironment {
	return { isFile: () => false, which: () => null, ...overrides };
}

const savedPath = process.env.PATH;

afterEach(() => {
	process.env.PATH = savedPath;
});

describe("claude executable resolution", () => {
	test("claudeCode.cliPath wins when it is a file, and is reported and skipped when it is not", () => {
		const isFile = (path: string) => path === "/opt/claude";
		const which = () => "/usr/local/bin/claude";
		expect(resolveClaudeCliPath(env({ configured: "/opt/claude", isFile, which }))).toEqual({
			ok: true,
			path: "/opt/claude",
			source: "config",
			notes: [],
		});
		expect(resolveClaudeCliPath(env({ configured: "/missing/claude", isFile, which }))).toEqual({
			ok: true,
			path: "/usr/local/bin/claude",
			source: "path",
			notes: ["claudeCode.cliPath /missing/claude is not a file; ignored"],
		});
	});

	test("without a configured path, claude on PATH; without either, a reason naming both fixes", () => {
		const asked: string[] = [];
		const which = (name: string) => {
			asked.push(name);
			return null;
		};
		const missing = resolveClaudeCliPath(env({ which }));
		expect(asked).toEqual(["claude"]);
		expect(missing.ok).toBe(false);
		expect(!missing.ok && missing.reason).toContain("Install Claude Code");
		expect(!missing.ok && missing.reason).toContain('"claudeCode": {"cliPath": "/path/to/claude"}');
	});

	test("never throws: a failing step becomes a reason", () => {
		const thrown = resolveClaudeCliPath(
			env({
				which: () => {
					throw new Error("PATH unreadable");
				},
			}),
		);
		expect(thrown).toEqual({ ok: false, reason: "finding the Claude Code binary failed: PATH unreadable", notes: [] });
	});

	test("the default environment finds an executable claude on PATH", () => {
		const dir = mkdtempSync(join(tmpdir(), "broski-claude-path-"));
		const claude = join(dir, "claude");
		writeFileSync(claude, "#!/bin/sh\nexit 0\n");
		chmodSync(claude, 0o755);
		process.env.PATH = dir;
		expect(resolveClaudeCliPath(defaultClaudeCliEnvironment())).toEqual({
			ok: true,
			path: claude,
			source: "path",
			notes: [],
		});
		process.env.PATH = join(dir, "empty");
		expect(resolveClaudeCliPath(defaultClaudeCliEnvironment()).ok).toBe(false);
	});
});

describe("doctor", () => {
	test("reports the binary, where it came from and its version", () => {
		const check = claudeCliCheck({ ok: true, path: testClaudeBinary(), source: "path", notes: [] });
		expect(check).toMatchObject({ id: "claude_code", status: "ok" });
		expect(check.message).toMatch(/^Claude Code 2\.1\.316 \(PATH: .+\/claude\)$/);
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
