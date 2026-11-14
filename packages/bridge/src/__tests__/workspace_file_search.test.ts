/**
 * Project file search on a real directory tree in the temp directory, one of the bases the search allows.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFilesAndDirs } from "../workspace/files/file-search";
import { getCacheStats, invalidateCache, resetCacheStats } from "../workspace/files/file-search-cache";

const project = realpathSync(mkdtempSync(join(tmpdir(), "broski-search-")));
for (const path of [
	"src/server/contract-seam.ts",
	"src/server/connections.ts",
	"docs/architecture/core.md",
	"node_modules/dep/index.js",
	"README.md",
]) {
	mkdirSync(join(project, path, ".."), { recursive: true });
	writeFileSync(join(project, path), "x");
}
writeFileSync(join(project, ".ignore"), "node_modules\n");

afterAll(() => rmSync(project, { recursive: true, force: true }));

beforeEach(() => {
	invalidateCache();
	resetCacheStats();
});

describe("searchFilesAndDirs", () => {
	test("finds files and directories by fuzzy name, best match first, and skips ignored trees", async () => {
		expect((await searchFilesAndDirs({ query: "contract-seam", cwd: project }))[0]).toBe("src/server/contract-seam.ts");
		expect(await searchFilesAndDirs({ query: "architecture", cwd: project })).toContain("docs/architecture/");
		expect(await searchFilesAndDirs({ query: "index.js", cwd: project })).toEqual([]);
		expect(await searchFilesAndDirs({ query: "server", cwd: project, includeDirs: false })).not.toContain(
			"src/server/",
		);
	});

	test("scans a project once and serves the next search from the cache", async () => {
		await searchFilesAndDirs({ query: "readme", cwd: project });
		expect(getCacheStats()).toMatchObject({ misses: 1 });
		await searchFilesAndDirs({ query: "core", cwd: project });
		expect(getCacheStats()).toMatchObject({ misses: 1, hits: 1 });
	});

	test("refuses a directory outside the home and the temp directory", async () => {
		expect(await searchFilesAndDirs({ query: "passwd", cwd: "/etc" })).toEqual([]);
	});
});
