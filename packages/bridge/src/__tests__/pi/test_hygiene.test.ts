/**
 * The Pi tests share one process environment: `createPiTestEnv` replaces `process.env` and the fake `trash` heads
 * `PATH` while a test runs. Two tests of these files running at once would see each other's homes, so none may run
 * concurrently.
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("no Pi test runs concurrently with another", () => {
	const files = readdirSync(import.meta.dir, { recursive: true, encoding: "utf8" }).filter((name) =>
		name.endsWith(".ts"),
	);
	const concurrent = files.filter((name) =>
		/\b(?:test|it|describe)\.concurrent\b|\.concurrent\(/.test(readFileSync(join(import.meta.dir, name), "utf8")),
	);
	expect(files.length).toBeGreaterThan(50);
	expect(concurrent).toEqual([]);
});
