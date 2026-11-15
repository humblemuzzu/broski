/**
 * The temp roots the allowlist has always advertised. On macOS `/tmp` is a symlink to
 * `/private/tmp`, so a base kept only in its lexical spelling — or only in its resolved one — refuses
 * every valid path under a temp directory.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SecurePath } from "../core/secure-path";
import { expandAllowedBasePaths } from "../security";

const CHILD_SCRIPT = resolve(import.meta.dir, "safety", "secure-path-child.ts");
const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..");

const created: string[] = [];

function tempDirIn(root: string): string {
	const dir = mkdtempSync(join(root, "broski-secure-"));
	created.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("expandAllowedBasePaths", () => {
	test("keeps a base whose resolved form is itself", () => {
		const real = realpathSync.native(tmpdir());
		expect(expandAllowedBasePaths([real])).toEqual([real]);
	});

	test("keeps both spellings of a symlinked root", () => {
		const expanded = expandAllowedBasePaths(["/tmp"]);
		expect(expanded).toContain("/tmp");
		expect(expanded).toContain(realpathSync.native("/tmp"));
	});

	test("resolves a relative base before keeping it", () => {
		expect(expandAllowedBasePaths(["."])[0]).toBe(resolve("."));
	});
});

describe("a path under a temp root, with the roots allowlisted as configured", () => {
	function resolveInChild(paths: string[]): Record<string, SecurePath> {
		const result = spawnSync("bun", [CHILD_SCRIPT, ...paths], {
			cwd: BRIDGE_ROOT,
			encoding: "utf-8",
			env: {
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				HOME: tempDirIn(tmpdir()),
				BROSKI_ALLOWED_BASE_PATHS: "/tmp,/var/tmp",
			},
		});
		const lines = (result.stdout ?? "").trim().split("\n");
		const last = lines[lines.length - 1] ?? "";
		if (!last.startsWith("{")) throw new Error(`child printed no result (status ${result.status}): ${result.stderr}`);
		return JSON.parse(last) as Record<string, SecurePath>;
	}

	test("/tmp is accepted as written and resolves to its real path", () => {
		const dir = tempDirIn("/tmp");
		const file = join(dir, "file.txt");
		writeFileSync(file, "x");
		expect(resolveInChild([file])[file]).toEqual({ path: realpathSync(file) });
	});

	test("/var/tmp is accepted as written and resolves to its real path", () => {
		const dir = tempDirIn("/var/tmp");
		const file = join(dir, "file.txt");
		writeFileSync(file, "x");
		expect(resolveInChild([file])[file]).toEqual({ path: realpathSync(file) });
	});

	test("a directory under /tmp is accepted and a path outside the roots is not", () => {
		const dir = tempDirIn("/tmp");
		const nested = join(dir, "nested");
		mkdirSync(nested);
		const answers = resolveInChild([nested, "/etc/hosts"]);
		expect(answers[nested]).toEqual({ path: realpathSync(nested) });
		expect(answers["/etc/hosts"]).toEqual({ refused: "outside" });
	});
});
