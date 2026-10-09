import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { createFindTool, createLsTool } from "@earendil-works/pi-coding-agent";
import { createPiDurableFindOperations } from "../../connectors/pi-durable/tools/find-operations";
import { walkFiles } from "../../connectors/pi-durable/tools/fs-walk";
import { matchesGlob } from "../../connectors/pi-durable/tools/glob-match";
import { runGrepSearch } from "../../connectors/pi-durable/tools/grep-tool";
import { toJsonValue } from "../../connectors/pi-durable/tools/json-value";

const LONG_LINE = "x".repeat(900);
const TRUNCATED_LINE = `${LONG_LINE.slice(0, 500)}... [truncated]`;

type ToolContent = readonly (TextContent | ImageContent)[];

function writeFiles(root: string, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(root, path);
		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}
}

function createFixture(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-durable-search-"));
	writeFiles(root, {
		".gitignore": "ignored/\nnode_modules/\n",
		".hidden": "greeting from a dotfile\n",
		"a.ts": "export const greeting = 'hello';\nconst x = 1;\n",
		"b.md": "# readme\n",
		"binary.bin": "greeting\u0000binary\n",
		"ignored/e.ts": "const greeting = 'ignored';\n",
		"long.txt": `${LONG_LINE}greeting\n`,
		"meta.txt": "total (net) 5\n",
		"node_modules/d.ts": "const greeting = 'vendored';\n",
		"sub/c.ts": "const greeting = 'world';\n",
	});
	return root;
}

function toolText(content: ToolContent): string {
	const first = content[0];
	return first !== undefined && first.type === "text" ? first.text : "";
}

function findTool(cwd: string) {
	return createFindTool(cwd, { operations: createPiDurableFindOperations() });
}

describe("pi-durable ls tool", () => {
	test("lists entries alphabetically with directories suffixed and dotfiles included", async () => {
		const ls = createLsTool(createFixture());
		const result = await ls.execute("call-ls", { path: "." }, undefined, undefined);
		expect(toolText(result.content)).toBe(
			".gitignore\n.hidden\na.ts\nb.md\nbinary.bin\nignored/\nlong.txt\nmeta.txt\nnode_modules/\nsub/",
		);
	});

	test("reports a path that does not exist", async () => {
		const ls = createLsTool(createFixture());
		const call = ls.execute("call-ls", { path: "missing" }, undefined, undefined);
		await expect(call).rejects.toThrow("Path not found: ");
	});
});

describe("pi-durable find tool", () => {
	test("matches a basename glob and skips gitignored trees", async () => {
		const result = await findTool(createFixture()).execute("call-find", { pattern: "*.ts" }, undefined, undefined);
		expect(toolText(result.content)).toBe("a.ts\nsub/c.ts");
	});

	test("matches a path glob and stops at the result limit", async () => {
		const find = findTool(createFixture());
		const nested = await find.execute("call-find", { pattern: "sub/*.ts" }, undefined, undefined);
		expect(toolText(nested.content)).toBe("sub/c.ts");
		const limited = await find.execute("call-find", { pattern: "*.ts", limit: 1 }, undefined, undefined);
		expect(toolText(limited.content)).toBe("a.ts\n\n[1 results limit reached]");
		expect(limited.details).toEqual({ resultLimitReached: 1 });
	});

	test("matches a single-file search path", async () => {
		const find = findTool(createFixture());
		const hit = await find.execute("call-find", { pattern: "*.ts", path: "a.ts" }, undefined, undefined);
		expect(toolText(hit.content)).toBe("a.ts");
		const miss = await find.execute("call-find", { pattern: "*.md", path: "a.ts" }, undefined, undefined);
		expect(toolText(miss.content)).toBe("No files found matching pattern");
	});

	test("reports no matches and a missing search path", async () => {
		const find = findTool(createFixture());
		const empty = await find.execute("call-find", { pattern: "*.rs" }, undefined, undefined);
		expect(toolText(empty.content)).toBe("No files found matching pattern");
		const call = find.execute("call-find", { pattern: "*.ts", path: "missing" }, undefined, undefined);
		await expect(call).rejects.toThrow("Path not found: ");
	});
});

describe("matchesGlob", () => {
	test("treats a pattern without a slash as a basename and one with a slash as a path", () => {
		expect(matchesGlob("a.ts", "*.ts")).toBe(true);
		expect(matchesGlob("sub/c.ts", "*.ts")).toBe(true);
		expect(matchesGlob("sub/c.ts", "*.md")).toBe(false);
		expect(matchesGlob("sub/c.ts", "sub/*.ts")).toBe(true);
		expect(matchesGlob("a.spec.ts", "**/*.spec.ts")).toBe(true);
		expect(matchesGlob("src/a.spec.ts", "src/**/*.spec.ts")).toBe(true);
		expect(matchesGlob("src/deep/a.spec.ts", "src/**/*.spec.ts")).toBe(true);
	});
});

describe("walkFiles", () => {
	test("walks sorted, honours .gitignore and nested .gitignore, and never enters .git", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-durable-walk-"));
		writeFiles(root, {
			".git/config": "",
			"keep/.gitignore": "drop/\n",
			"keep/a.ts": "",
			"keep/drop/b.ts": "",
			"node_modules/c.ts": "",
		});
		const seen: string[] = [];
		await walkFiles(root, {
			ignore: ["**/node_modules/**"],
			onFile: (_absolutePath, relativePath) => {
				seen.push(relativePath);
				return true;
			},
		});
		expect(seen).toEqual(["keep/.gitignore", "keep/a.ts"]);
	});

	test("applies the repository's own .gitignore files above the search root", async () => {
		const repository = mkdtempSync(join(tmpdir(), "pi-durable-repo-"));
		writeFiles(repository, {
			".git/HEAD": "",
			".gitignore": "build/\n",
			"pkg/.gitignore": "dist/\n",
			"pkg/build/b.ts": "",
			"pkg/dist/c.ts": "",
			"pkg/keep/d.ts": "",
		});
		const seen: string[] = [];
		await walkFiles(join(repository, "pkg"), {
			onFile: (_absolutePath, relativePath) => {
				seen.push(relativePath);
				return true;
			},
		});
		expect(seen).toEqual([".gitignore", "keep/d.ts"]);
	});

	test("ignores no parent rules outside a repository", async () => {
		const outer = mkdtempSync(join(tmpdir(), "pi-durable-plain-"));
		const inner = join(outer, "inner");
		writeFiles(outer, {
			".gitignore": "skip/\n",
			"inner/keep/y.ts": "",
			"inner/skip/x.ts": "",
		});
		const seen: string[] = [];
		await walkFiles(inner, {
			onFile: (_absolutePath, relativePath) => {
				seen.push(relativePath);
				return true;
			},
		});
		expect(seen).toEqual(["keep/y.ts", "skip/x.ts"]);
	});

	test("stops when the visitor returns false", async () => {
		const root = createFixture();
		const seen: string[] = [];
		await walkFiles(root, {
			onFile: (_absolutePath, relativePath) => {
				seen.push(relativePath);
				return seen.length < 2;
			},
		});
		expect(seen).toEqual([".gitignore", ".hidden"]);
	});
});

describe("pi-durable grep search", () => {
	test("reports file paths with line numbers and skips gitignored and binary files", async () => {
		const outcome = await runGrepSearch({ cwd: createFixture(), pattern: "greeting" });
		expect(outcome.text).toBe(
			[
				".hidden:1: greeting from a dotfile",
				"a.ts:1: export const greeting = 'hello';",
				`long.txt:1: ${TRUNCATED_LINE}`,
				"sub/c.ts:1: const greeting = 'world';",
				"",
				"[Some lines truncated to 500 chars. Use read tool to see full lines]",
			].join("\n"),
		);
		expect(outcome.details).toEqual({ linesTruncated: true });
	});

	test("honours ignoreCase, the file glob, context lines and a single file path", async () => {
		const root = createFixture();
		const insensitive = await runGrepSearch({ cwd: root, pattern: "GREETING", ignoreCase: true });
		expect(insensitive.text).toContain("a.ts:1: export const greeting = 'hello';");
		const globbed = await runGrepSearch({ cwd: root, pattern: "greeting", glob: "a.ts" });
		expect(globbed.text).toBe("a.ts:1: export const greeting = 'hello';");
		const contextual = await runGrepSearch({ cwd: root, pattern: "greeting", path: "a.ts", context: 1 });
		expect(contextual.text).toBe("a.ts:1: export const greeting = 'hello';\na.ts-2- const x = 1;");
	});

	test("treats the pattern as a literal string only when asked", async () => {
		const root = createFixture();
		await expect(runGrepSearch({ cwd: root, pattern: "(net" })).rejects.toThrow("Invalid pattern: ");
		const literal = await runGrepSearch({ cwd: root, pattern: "(net", literal: true });
		expect(literal.text).toBe("meta.txt:1: total (net) 5");
	});

	test("caps matches at the limit and says how to continue", async () => {
		const outcome = await runGrepSearch({ cwd: createFixture(), pattern: "greeting", limit: 2 });
		expect(outcome.text).toBe(
			[
				".hidden:1: greeting from a dotfile",
				"a.ts:1: export const greeting = 'hello';",
				"",
				"[2 matches limit reached. Use limit=4 for more, or refine pattern]",
			].join("\n"),
		);
		expect(outcome.details).toEqual({ matchLimitReached: 2 });
	});

	test("truncates the output at the byte limit", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-durable-grep-bytes-"));
		const line = `${LONG_LINE}greeting`;
		writeFiles(root, { "big.txt": `${Array.from({ length: 200 }, () => line).join("\n")}\n` });
		const outcome = await runGrepSearch({ cwd: root, pattern: "greeting", limit: 200 });
		expect(outcome.text).toContain("200 matches limit reached");
		expect(outcome.text).toContain("50.0KB limit reached");
		expect(outcome.details).toMatchObject({ truncation: { truncated: true, truncatedBy: "bytes" } });
	});

	test("reports no matches and a missing search path", async () => {
		const root = createFixture();
		const empty = await runGrepSearch({ cwd: root, pattern: "absent-token" });
		expect(empty.text).toBe("No matches found");
		expect(empty.details).toBeUndefined();
		const call = runGrepSearch({ cwd: root, pattern: "greeting", path: "missing" });
		await expect(call).rejects.toThrow("Path not found: ");
	});
});

describe("toJsonValue", () => {
	test("drops undefined members and non-JSON scalars", () => {
		expect(toJsonValue({ a: 1, b: undefined, c: [1, undefined, { d: "e" }] })).toEqual({ a: 1, c: [1, { d: "e" }] });
		expect(toJsonValue(undefined)).toBeUndefined();
		expect(toJsonValue(10n)).toBeUndefined();
	});
});
