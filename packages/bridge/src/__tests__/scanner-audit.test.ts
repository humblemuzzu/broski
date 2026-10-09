/**
 * Scanner Audit Tests
 *
 * Verifies that the bridge scanners correctly discover all commands, skills,
 * agents, hooks, and prompts from the broski project's .claude/, .codex/, .opencode/ dirs.
 */
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// The broski project root (two dirs up from packages/bridge/src/__tests__)
const BROSKI_ROOT = resolve(__dirname, "..", "..", "..", "..");

const HAS_CC_SKILLS = existsSync(resolve(BROSKI_ROOT, ".claude", "skills"));
const HAS_CC_AGENTS = existsSync(resolve(BROSKI_ROOT, ".claude", "agents"));
const HAS_CC_SETTINGS = existsSync(resolve(BROSKI_ROOT, ".claude", "settings.json"));

describe("Claude Code Scanners", () => {
	it("listCommands finds all .claude/commands/*.md files", async () => {
		const { listCommands } = await import("../connectors/claude-code");
		const commands = await listCommands(BROSKI_ROOT);

		const names = commands.map((c) => c.name);
		console.log("[CC Commands]", names);

		// These files exist on disk
		expect(names).toContain("run-tests");
		expect(names).toContain("add-provider");
		expect(names).toContain("fix-lint");
		expect(names).toContain("debug-connection");
		expect(names).toContain("generate-model");
		expect(commands.length).toBeGreaterThanOrEqual(5);

		// Verify descriptions are parsed
		const runTests = commands.find((c) => c.name === "run-tests");
		expect(runTests?.description).toBeTruthy();

		// BUG 2 FIX: Verify source tagging is correct
		const projectCommands = commands.filter((c) => c.source === "project");
		const userCommands = commands.filter((c) => c.source === "user");
		console.log(`[CC Commands] source: project=${projectCommands.length} user=${userCommands.length}`);
		// Project commands should be tagged as 'project' (not 'user')
		expect(projectCommands.length).toBeGreaterThanOrEqual(5);
	});

	it.skipIf(!HAS_CC_SKILLS)("listSkills finds all .claude/skills/*/SKILL.md files with correct source", async () => {
		const { listSkills } = await import("../connectors/claude-code");
		const skills = await listSkills(BROSKI_ROOT);

		const names = skills.map((s) => s.name);
		console.log("[CC Skills]", names);

		expect(names).toContain("broski-helper");
		expect(names).toContain("api-debugger");
		expect(names).toContain("flutter-expert");
		expect(skills.length).toBeGreaterThanOrEqual(3);

		// Verify descriptions are parsed
		const helper = skills.find((s) => s.name === "broski-helper");
		expect(helper?.description).toBeTruthy();

		// BUG 2 FIX: Verify source tagging is correct
		const projectSkills = skills.filter((s) => s.source === "project");
		console.log(`[CC Skills] source: project=${projectSkills.length}`);
		expect(projectSkills.length).toBeGreaterThanOrEqual(3);
	});

	it.skipIf(!HAS_CC_AGENTS)("listAgents finds all .claude/agents/*.md files with correct source", async () => {
		const { listAgents } = await import("../connectors/claude-code");
		const agents = await listAgents(BROSKI_ROOT);

		const names = agents.map((a) => a.name);
		console.log("[CC Agents]", names);

		expect(names).toContain("code-reviewer");
		expect(names).toContain("test-writer");
		expect(names).toContain("refactor-expert");
		expect(agents.length).toBeGreaterThanOrEqual(3);

		// Verify descriptions are parsed from frontmatter
		const reviewer = agents.find((a) => a.name === "code-reviewer");
		expect(reviewer?.description).toBeTruthy();

		// BUG 2 FIX: Verify source tagging is correct
		const projectAgents = agents.filter((a) => a.source === "project");
		console.log(`[CC Agents] source: project=${projectAgents.length}`);
		expect(projectAgents.length).toBeGreaterThanOrEqual(3);
	});

	it.skipIf(!HAS_CC_SETTINGS)("listHooks reads from settings.json AND hooks.json", async () => {
		const { listHooks } = await import("../connectors/claude-code");
		const hooks = await listHooks(BROSKI_ROOT);

		console.log("[CC Hooks]", hooks.length, "hooks found");
		console.log(
			"[CC Hooks] events:",
			hooks.map((h) => `${h.event}:${h.matcher ?? "*"}`),
		);
		console.log(
			"[CC Hooks] sources:",
			hooks.map((h) => h.source),
		);

		// BUG 1 FIX: Broski project has hooks in settings.json (SessionStart, PreToolUse, PostToolUse)
		// The scanner should now find them.
		const events = hooks.map((h) => h.event);
		expect(events).toContain("SessionStart");
		expect(events).toContain("PreToolUse");
		expect(events).toContain("PostToolUse");
		expect(hooks.length).toBeGreaterThanOrEqual(3);

		// Verify details
		const preToolUse = hooks.find((h) => h.event === "PreToolUse");
		expect(preToolUse?.matcher).toBe("Bash");
		expect(preToolUse?.source).toBe("project");

		const postToolUse = hooks.find((h) => h.event === "PostToolUse");
		expect(postToolUse?.matcher).toBe("Write|Edit");
	});
});

describe("OpenCode Scanners (filesystem-based)", () => {
	it("listOpenCodeSkills finds all .opencode/skill/*/SKILL.md files", async () => {
		const { listOpenCodeSkills } = await import("../skills");
		const skills = await listOpenCodeSkills(BROSKI_ROOT);

		const projectSkills = skills.filter((s) => s.source === "project");
		const names = projectSkills.map((s) => s.name);
		console.log("[OC Skills]", names);

		expect(names).toContain("broski-helper");
		expect(names).toContain("api-debugger");
		expect(names).toContain("flutter-expert");
		expect(projectSkills.length).toBeGreaterThanOrEqual(3);
	});
});

describe("Codex Scanners (filesystem-based)", () => {
	it("listCodexRepoSkills finds all .codex/skills/*/SKILL.md files", async () => {
		const { listCodexRepoSkills } = await import("../skills");
		const skills = await listCodexRepoSkills(BROSKI_ROOT);

		const names = skills.map((s) => s.name);
		console.log("[CX Skills]", names);

		expect(names).toContain("broski-helper");
		expect(names).toContain("api-debugger");
		expect(names).toContain("flutter-expert");
		expect(skills.length).toBeGreaterThanOrEqual(3);
	});

	it("listCodexPrompts finds all .codex/prompts/*.md files", async () => {
		const { listCodexPrompts } = await import("../skills");
		const prompts = await listCodexPrompts(BROSKI_ROOT);

		const names = prompts.map((p) => p.name);
		console.log("[CX Prompts]", names);

		// BUG 3 FIX: These files exist on disk in .codex/prompts/
		expect(names).toContain("run-tests");
		expect(names).toContain("fix-lint");
		expect(names).toContain("debug-connection");
		expect(names).toContain("code-review");
		expect(names).toContain("generate-model");
		expect(prompts.length).toBeGreaterThanOrEqual(5);

		// Verify frontmatter is parsed
		const runTests = prompts.find((p) => p.name === "run-tests");
		expect(runTests?.description).toBeTruthy();
		expect(runTests?.argumentHint).toBeTruthy();
		expect(runTests?.source).toBe("project");
		expect(runTests?.content).toContain("flutter test");
	});
});

describe("File Search Module", () => {
	it("finds files in the broski project", async () => {
		const { searchFilesAndDirs } = await import("../file-search");
		const results = await searchFilesAndDirs({
			query: "chat_screen",
			cwd: BROSKI_ROOT,
			limit: 10,
			includeDirs: false,
		});

		console.log('[File Search] "chat_screen" →', results.slice(0, 3));
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.includes("chat_screen.dart"))).toBe(true);
	});

	it("finds directories in the broski project", async () => {
		const { searchFilesAndDirs } = await import("../file-search");
		const results = await searchFilesAndDirs({
			query: "providers",
			cwd: BROSKI_ROOT,
			limit: 20,
			includeDirs: true,
		});

		console.log('[File Search] "providers" →', results.slice(0, 5));
		expect(results.some((r) => r.includes("providers"))).toBe(true);
	});

	it("returns results fast (under 5s first run, under 100ms cached)", async () => {
		const { searchFilesAndDirs, invalidateCache } = await import("../file-search");

		// Clear cache for fair test
		invalidateCache(BROSKI_ROOT);

		const start1 = performance.now();
		const results1 = await searchFilesAndDirs({
			query: "bridge",
			cwd: BROSKI_ROOT,
			limit: 20,
			includeDirs: true,
		});
		const time1 = performance.now() - start1;

		console.log(`[File Search] First run: ${time1.toFixed(0)}ms, ${results1.length} results`);
		expect(time1).toBeLessThan(5000);

		// Second run should be cached
		const start2 = performance.now();
		const results2 = await searchFilesAndDirs({
			query: "server",
			cwd: BROSKI_ROOT,
			limit: 20,
			includeDirs: true,
		});
		const time2 = performance.now() - start2;

		console.log(`[File Search] Cached run: ${time2.toFixed(1)}ms, ${results2.length} results`);
		expect(time2).toBeLessThan(100);
	});
});
