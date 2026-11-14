/** The config watcher: a change in a commands, skills, agents or output styles folder invalidates the catalogue once. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigWatch, createConfigWatch } from "../../../backends/claude-code/models/config-watch";

const roots: string[] = [];
let watch: ConfigWatch | undefined;

afterEach(() => {
	watch?.dispose();
	watch = undefined;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-watch-")));
	roots.push(root);
	return root;
}

/** The OS starts delivering a new watch's events a moment after `fs.watch` returns; a long-lived watch never notices. */
function armed(): Promise<void> {
	return Bun.sleep(250);
}

async function until(condition: () => boolean, ms = 3_000): Promise<void> {
	const end = Date.now() + ms;
	while (!condition() && Date.now() < end) await Bun.sleep(10);
}

function watching(configRoot: string) {
	const invalidated: (string | undefined)[] = [];
	watch = createConfigWatch({
		configRoot,
		catalogue: { invalidate: (cwd) => void invalidated.push(cwd) },
		debounceMs: 40,
	});
	return invalidated;
}

describe("createConfigWatch", () => {
	test("a command written in the user's folder invalidates everything, once for a burst of writes", async () => {
		const configRoot = temp();
		mkdirSync(join(configRoot, "commands"));
		const invalidated = watching(configRoot);
		watch?.start();
		await armed();
		for (let index = 0; index < 5; index += 1) writeFileSync(join(configRoot, "commands", `c${index}.md`), "x");
		await until(() => invalidated.length > 0);
		await Bun.sleep(150);
		expect(invalidated).toEqual([undefined]);
	});

	test("a folder that does not exist yet is picked up when it appears", async () => {
		const configRoot = temp();
		const invalidated = watching(configRoot);
		watch?.start();
		await armed();
		mkdirSync(join(configRoot, "agents"));
		await until(() => invalidated.length > 0);
		await armed();
		invalidated.length = 0;
		writeFileSync(join(configRoot, "agents", "reviewer.md"), "x");
		await until(() => invalidated.length > 0);
		expect(invalidated).toEqual([undefined]);
	});

	test("a change in a tracked project invalidates that project only, also in a subfolder", async () => {
		const configRoot = temp();
		const project = temp();
		mkdirSync(join(project, ".claude", "skills", "lint"), { recursive: true });
		const invalidated = watching(configRoot);
		watch?.track(project);
		await armed();
		writeFileSync(join(project, ".claude", "skills", "lint", "SKILL.md"), "x");
		await until(() => invalidated.length > 0);
		expect(invalidated).toEqual([project]);
	});

	test("files that are not commands, skills, agents or styles do not invalidate anything", async () => {
		const configRoot = temp();
		mkdirSync(join(configRoot, "projects"));
		mkdirSync(join(configRoot, "commands"));
		const invalidated = watching(configRoot);
		watch?.start();
		await armed();
		writeFileSync(join(configRoot, "settings.json"), "{}");
		writeFileSync(join(configRoot, "projects", "session.jsonl"), "{}");
		await Bun.sleep(250);
		expect(invalidated).toEqual([]);
		writeFileSync(join(configRoot, "commands", "c.md"), "x");
		await until(() => invalidated.length > 0);
		expect(invalidated).toEqual([undefined]);
	});

	test("nothing fires after dispose", async () => {
		const configRoot = temp();
		mkdirSync(join(configRoot, "commands"));
		const invalidated = watching(configRoot);
		watch?.start();
		watch?.dispose();
		writeFileSync(join(configRoot, "commands", "late.md"), "x");
		await Bun.sleep(250);
		expect(invalidated).toEqual([]);
	});

	test("tracking more than the bound lets the oldest project go", async () => {
		const configRoot = temp();
		const first = temp();
		mkdirSync(join(first, ".claude", "commands"), { recursive: true });
		const invalidated = watching(configRoot);
		watch?.track(first);
		await armed();
		writeFileSync(join(first, ".claude", "commands", "x.md"), "x");
		await until(() => invalidated.length > 0);
		expect(invalidated).toEqual([first]);
		for (let index = 0; index < 16; index += 1) {
			const project = temp();
			mkdirSync(join(project, ".claude"), { recursive: true });
			watch?.track(project);
		}
		invalidated.length = 0;
		writeFileSync(join(first, ".claude", "commands", "y.md"), "x");
		await Bun.sleep(250);
		expect(invalidated).toEqual([]);
	});
});
