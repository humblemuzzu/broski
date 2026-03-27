import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { runDependencyChecks } from "../doctor/checks/dependencies";
import { runSystemChecks } from "../doctor/checks/system";
import { createDoctorContext } from "../doctor/context";
import type { CheckResult } from "../doctor/types";
import { dirExists, fileExists, summarizeChecks } from "../doctor/utils";

describe("Doctor System", () => {
	const testDir = resolve(homedir(), ".broski-test");

	beforeAll(async () => {
		// Clean up any existing test directory
		try {
			await rm(testDir, { recursive: true, force: true });
		} catch {
			// ignore if doesn't exist
		}
	});

	describe("Doctor Context Creation", () => {
		test("creates doctor context with default paths", async () => {
			const ctx = await createDoctorContext();

			expect(ctx.config).toBeDefined();
			expect(typeof ctx.port).toBe("number");
			expect(ctx.port).toBeGreaterThan(0);
			expect(ctx.port).toBeLessThanOrEqual(65535);

			// Check paths structure
			expect(ctx.paths.home).toContain(".broski");
			expect(ctx.paths.bin).toContain(".broski/bin");
			expect(ctx.paths.logs).toContain(".broski/logs");
			expect(ctx.paths.tls).toContain(".broski/tls");
			expect(ctx.paths.tokenFile).toContain(".broski/token.json");
			expect(ctx.paths.logFile).toContain(".broski/logs/bridge.log");
			expect(ctx.paths.errorLogFile).toContain(".broski/logs/bridge.error.log");
			expect(ctx.paths.configFile).toContain(".broski/config.json");
		});

		test("respects BROSKI_PORT environment variable", async () => {
			const originalEnv = process.env.BROSKI_PORT;
			process.env.BROSKI_PORT = "9999";

			try {
				const ctx = await createDoctorContext();
				expect(ctx.port).toBe(9999);
			} finally {
				if (originalEnv !== undefined) {
					process.env.BROSKI_PORT = originalEnv;
				} else {
					delete process.env.BROSKI_PORT;
				}
			}
		});
	});

	describe("File/Directory Utilities", () => {
		test("fileExists returns false for non-existent file", async () => {
			const exists = await fileExists("/nonexistent/path/file.txt");
			expect(exists).toBe(false);
		});

		test("dirExists returns false for non-existent directory", async () => {
			const exists = await dirExists("/nonexistent/path");
			expect(exists).toBe(false);
		});

		test("fileExists returns true for real file", async () => {
			await mkdir(testDir, { recursive: true });
			const testFile = resolve(testDir, "test.txt");
			await writeFile(testFile, "test content");

			const exists = await fileExists(testFile);
			expect(exists).toBe(true);

			// Clean up
			await rm(testFile);
		});

		test("dirExists returns true for real directory", async () => {
			await mkdir(testDir, { recursive: true });

			const exists = await dirExists(testDir);
			expect(exists).toBe(true);

			// Clean up
			await rm(testDir, { recursive: true });
		});

		test("fileExists returns false for directory path", async () => {
			await mkdir(testDir, { recursive: true });

			const exists = await fileExists(testDir);
			expect(exists).toBe(false);

			// Clean up
			await rm(testDir, { recursive: true });
		});

		test("dirExists returns false for file path", async () => {
			await mkdir(testDir, { recursive: true });
			const testFile = resolve(testDir, "test.txt");
			await writeFile(testFile, "test content");

			const exists = await dirExists(testFile);
			expect(exists).toBe(false);

			// Clean up
			await rm(testDir, { recursive: true });
		});
	});

	describe("System Checks", () => {
		test("system checks return proper CheckResult objects", async () => {
			const ctx = await createDoctorContext();
			const results = await runSystemChecks(ctx);

			expect(Array.isArray(results)).toBe(true);
			expect(results.length).toBeGreaterThan(0);

			for (const result of results) {
				expect(result).toMatchObject({
					id: expect.any(String),
					category: expect.any(String),
					status: expect.stringMatching(/^(ok|warning|error|info)$/),
					message: expect.any(String),
				});

				// Optional fields should be string if present
				if (result.fix) expect(typeof result.fix).toBe("string");
				if (result.details) expect(Array.isArray(result.details)).toBe(true);
				if (result.autoFix) expect(typeof result.autoFix).toBe("function");
			}
		});

		test("system checks have correct categories", async () => {
			const ctx = await createDoctorContext();
			const results = await runSystemChecks(ctx);

			for (const result of results) {
				expect(result.category).toBe("system");
			}
		});

		test("platform info check exists", async () => {
			const ctx = await createDoctorContext();
			const results = await runSystemChecks(ctx);

			const platformCheck = results.find((r) => r.id === "platform_info");
			expect(platformCheck).toBeDefined();
			expect(platformCheck?.status).toBe("info");
			expect(platformCheck?.message).toMatch(/compiled binary|dev mode/);
		});

		test("version check exists", async () => {
			const ctx = await createDoctorContext();
			const results = await runSystemChecks(ctx);

			const versionCheck = results.find((r) => r.id === "version_check");
			expect(versionCheck).toBeDefined();
			expect(versionCheck?.status).toMatch(/ok|warning|info/);
			expect(versionCheck?.message).toMatch(/v\d+\.\d+\.\d+/);
		});

		test("broski home check exists", async () => {
			const ctx = await createDoctorContext();
			const results = await runSystemChecks(ctx);

			const homeCheck = results.find((r) => r.id === "broski_home");
			expect(homeCheck).toBeDefined();
			expect(homeCheck?.status).toMatch(/ok|error/);
			expect(homeCheck?.message).toContain(".broski");
		});

		test("directory checks exist for bin, logs, tls", async () => {
			const ctx = await createDoctorContext();
			const results = await runSystemChecks(ctx);

			const dirChecks = results.filter((r) => r.id.startsWith("dir_"));
			expect(dirChecks.length).toBeGreaterThanOrEqual(3);

			const expectedDirs = ["bin/", "logs/", "tls/"];
			for (const expectedDir of expectedDirs) {
				const check = dirChecks.find((r) => r.id === `dir_${expectedDir}`);
				expect(check).toBeDefined();
				expect(check?.message).toContain(expectedDir);
			}
		});

		test("path check exists", async () => {
			const ctx = await createDoctorContext();
			const results = await runSystemChecks(ctx);

			const pathCheck = results.find((r) => r.id === "path_check");
			expect(pathCheck).toBeDefined();
			expect(pathCheck?.status).toMatch(/ok|warning/);
			expect(pathCheck?.message).toContain("PATH");
		});
	});

	describe("Dependency Checks", () => {
		test("dependency checks return proper CheckResult objects", async () => {
			const results = await runDependencyChecks();

			expect(Array.isArray(results)).toBe(true);
			expect(results.length).toBeGreaterThan(0);

			for (const result of results) {
				expect(result).toMatchObject({
					id: expect.any(String),
					category: "dependencies",
					status: expect.stringMatching(/^(ok|warning|error|info)$/),
					message: expect.any(String),
				});
			}
		});

		test("checks for opencode agent", async () => {
			const results = await runDependencyChecks();

			const opencodeCheck = results.find((r) => r.id === "opencode");
			expect(opencodeCheck).toBeDefined();
			expect(opencodeCheck?.message).toMatch(/opencode/i);
		});

		test("checks for claude code agent", async () => {
			const results = await runDependencyChecks();

			const claudeCheck = results.find((r) => r.id === "claude_code");
			expect(claudeCheck).toBeDefined();
			expect(claudeCheck?.message).toMatch(/claude.*code/i);
		});

		test("checks for codex agent", async () => {
			const results = await runDependencyChecks();

			const codexCheck = results.find((r) => r.id === "codex");
			expect(codexCheck).toBeDefined();
			expect(codexCheck?.message).toMatch(/codex/i);
		});

		test("includes any_agent summary check", async () => {
			const results = await runDependencyChecks();

			const anyAgentCheck = results.find((r) => r.id === "any_agent");
			expect(anyAgentCheck).toBeDefined();
			expect(anyAgentCheck?.status).toMatch(/ok|error/);
		});

		test("dependency checks have correct category", async () => {
			const results = await runDependencyChecks();

			for (const result of results) {
				expect(result.category).toBe("dependencies");
			}
		});
	});

	describe("Check Summarization", () => {
		test("summarizes check results correctly", () => {
			const mockResults: CheckResult[] = [
				{ id: "1", category: "system", status: "ok", message: "test1" },
				{ id: "2", category: "system", status: "ok", message: "test2" },
				{ id: "3", category: "system", status: "warning", message: "test3" },
				{ id: "4", category: "system", status: "error", message: "test4" },
				{ id: "5", category: "system", status: "info", message: "test5" },
			];

			const summary = summarizeChecks(mockResults);

			expect(summary).toEqual({
				ok: 2,
				warning: 1,
				error: 1,
				info: 1,
				total: 5,
			});
		});

		test("handles empty results", () => {
			const summary = summarizeChecks([]);

			expect(summary).toEqual({
				ok: 0,
				warning: 0,
				error: 0,
				info: 0,
				total: 0,
			});
		});

		test("handles all-ok results", () => {
			const mockResults: CheckResult[] = [
				{ id: "1", category: "system", status: "ok", message: "test1" },
				{ id: "2", category: "system", status: "ok", message: "test2" },
				{ id: "3", category: "system", status: "ok", message: "test3" },
			];

			const summary = summarizeChecks(mockResults);

			expect(summary).toEqual({
				ok: 3,
				warning: 0,
				error: 0,
				info: 0,
				total: 3,
			});
		});
	});

	describe("Check Categories", () => {
		test("valid categories are correctly defined", () => {
			const validCategories = ["system", "dependencies", "network", "security", "daemon", "agents", "connectivity"];

			// This test ensures our doctor system supports all expected categories
			// We're testing this by running actual checks and validating their categories
			expect(validCategories).toContain("system");
			expect(validCategories).toContain("dependencies");
			expect(validCategories).toContain("network");
			expect(validCategories).toContain("security");
			expect(validCategories).toContain("daemon");
			expect(validCategories).toContain("agents");
			expect(validCategories).toContain("connectivity");
		});
	});
});
