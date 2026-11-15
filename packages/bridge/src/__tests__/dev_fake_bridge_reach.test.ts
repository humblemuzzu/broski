import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import packageMeta from "../../package.json";
import { importSites } from "../../scripts/contract-gen/import-scan";
import { readCommand } from "../../scripts/dev-fake-bridge/commands";
import { HOME_DERIVED_ENV, homeOutsideTemp } from "../../scripts/dev-fake-bridge/home-guard";

const BRIDGE = resolve(import.meta.dir, "../..");

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.[cm]?[jt]s$/.test(path) ? [path] : [];
	});
}

const shipped = () =>
	[...sources(join(BRIDGE, "src")), ...sources(join(BRIDGE, "bin"))].filter((path) => !path.includes("__tests__"));

/** Whether `specifier` reaches into a `scripts` directory: `../scripts/x`, `../../scripts`. */
const intoScripts = (specifier: string) => /(^|\/)scripts(\/|$)/.test(specifier);

/**
 * The fake bridge (`scripts/dev-fake-bridge.ts`) registers the contract's fake backend. It must never
 * reach a user: the compiled binary is built from an entry in `src/`, and the npm package ships only
 * `bin` and `src`, none of which imports anything under `scripts/` or names the fake bridge at all
 * (which a spawn of it would).
 */
describe("the dev fake bridge", () => {
	test("no file the bridge ships imports anything under scripts/", () => {
		const reaching = shipped().flatMap((path) =>
			importSites(readFileSync(path, "utf8"))
				.filter((site) => site.specifier === undefined || intoScripts(site.specifier))
				.map((site) => `${relative(BRIDGE, path)}:${site.line}`),
		);
		expect(reaching).toEqual([]);
	});

	test("no file the bridge ships names the fake bridge", () => {
		const naming = shipped().filter((path) => readFileSync(path, "utf8").includes("dev-fake-bridge"));
		expect(naming.map((path) => relative(BRIDGE, path))).toEqual([]);
	});

	test("a specifier into scripts/ is recognised however it is written", () => {
		for (const specifier of ["../scripts/x", "../../scripts", "scripts/dev-fake-bridge", "./scripts"]) {
			expect(intoScripts(specifier)).toBe(true);
		}
		expect(intoScripts("./transcripts/x")).toBe(false);
	});

	test("the npm package does not ship scripts/", () => {
		expect(packageMeta.files).not.toContain("scripts");
		expect(packageMeta.files.every((entry: string) => !entry.startsWith("scripts"))).toBe(true);
	});

	test("the compiled binary is built from an entry in src/", () => {
		const build = readFileSync(join(BRIDGE, "scripts", "build.sh"), "utf8");
		expect(build).toMatch(/^ENTRY="\.\/src\/[^"]+\.ts"$/m);
	});
});

describe("the dev fake bridge's start", () => {
	const home = join(tmpdir(), "fake-home");

	test("refuses a home, or any path derived from one, outside the temp directory", () => {
		expect(homeOutsideTemp({ HOME: home })).toBeNull();
		expect(homeOutsideTemp({ HOME: "/Users/someone" })).toContain("HOME=/Users/someone");
		for (const name of HOME_DERIVED_ENV) {
			expect(homeOutsideTemp({ HOME: home, [name]: join(home, "x") })).toBeNull();
			expect(homeOutsideTemp({ HOME: home, [name]: "/Users/someone/.x" })).toContain(`${name}=`);
		}
		expect(homeOutsideTemp({ HOME: home, CLAUDE_CONFIG_DIR: join(tmpdir(), "..", "escape") })).not.toBeNull();
	});

	test("uses them anyway only when told to", () => {
		expect(homeOutsideTemp({ HOME: "/Users/someone", BROSKI_DEV_REAL_HOME: "1" })).toBeNull();
		expect(homeOutsideTemp({ HOME: "/Users/someone", BROSKI_DEV_REAL_HOME: "yes" })).not.toBeNull();
	});
});

describe("the dev fake bridge's commands", () => {
	const session = { backend: "pi", sessionId: "s1" };

	test("are read whole, and nothing else is", () => {
		expect(readCommand(JSON.stringify({ id: 1, cmd: "seed", cwd: "/w" }))).toEqual({
			command: { id: 1, cmd: "seed", cwd: "/w" },
		});
		expect(readCommand(JSON.stringify({ id: 2, cmd: "script", session, scenario: "ask" }))).toHaveProperty("command");
		expect(readCommand(JSON.stringify({ id: 4, cmd: "restart" }))).toEqual({ command: { id: 4, cmd: "restart" } });
		for (const bad of [
			{ id: 3, cmd: "restart", session },
			{ id: 3, cmd: "script", session, scenario: "nope" },
			{ id: 3, cmd: "seed" },
			{ id: 3, cmd: "release", session: { backend: "pi" } },
			{ id: 3, cmd: "release", session, extra: true },
			{ id: 3, cmd: "drop" },
		]) {
			expect(readCommand(JSON.stringify(bad))).toMatchObject({ id: 3, error: expect.any(String) });
		}
		expect(readCommand("{")).toMatchObject({ id: null });
		expect(readCommand(JSON.stringify({ cmd: "seed", cwd: "/w" }))).toMatchObject({ id: null });
	});
});
