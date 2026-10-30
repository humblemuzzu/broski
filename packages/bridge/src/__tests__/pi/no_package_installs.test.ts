import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { PiCommandLister } from "../../backends/pi/commands";
import { withoutPackageInstalls } from "../../backends/pi/no-package-installs";
import { settingsOf } from "../../backends/pi/project-settings";
import { createWorld, trustProject, type World, writeAgentFile, writeFile } from "./catalogue_support";

let world: World;
let calls: string;

const SETTINGS = JSON.stringify({ packages: ["npm:missing-user-package", "git:github.com/example/missing-user-repo"] });
const PROJECT_SETTINGS = JSON.stringify({
	packages: ["npm:missing-project-package", "git:github.com/example/missing-project-repo"],
});

/** `npm` and `git` that only record how they were called, ahead of any real one on the PATH. */
function installRecorders(): void {
	const bin = join(world.env.root, "bin");
	calls = join(world.env.root, "calls.log");
	for (const tool of ["npm", "git"]) {
		const script = join(bin, tool);
		writeFile(script, `#!/bin/sh\necho "${tool} $@" >> ${JSON.stringify(calls)}\n`);
		chmodSync(script, 0o755);
	}
	process.env.PATH = `${bin}:${process.env.PATH}`;
}

const recorded = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);

/**
 * The read-only call a missing user package makes: where `npm` keeps global packages (`package-manager.ts:2102-2113`).
 * Pi's resolution runs twice per load, once to find what is missing and once in the load itself.
 */
const onlyGlobalRootProbes = () => {
	const calls = recorded();
	expect(calls.length).toBeGreaterThan(0);
	for (const call of calls) expect(call).toBe("npm root -g");
};

const installs = () => recorded().filter((line) => /\b(install|clone|fetch|pull)\b/.test(line));

function configurePackages(): void {
	writeAgentFile(world.env, "settings.json", SETTINGS);
	writeFile(join(world.env.cwd, ".pi", "settings.json"), PROJECT_SETTINGS);
	trustProject(world.env, world.env.cwd);
	writeAgentFile(world.env, "prompts/review.md", "---\ndescription: Review\n---\nBody\n");
}

async function reloadLoader(): Promise<void> {
	const settingsManager = settingsOf(world.env.cwd, world.env.agentDir);
	const loader = new DefaultResourceLoader({ cwd: world.env.cwd, agentDir: world.env.agentDir, settingsManager });
	await loader.reload();
}

const sources = () => ({ agentDir: world.env.agentDir, extensions: () => [] });

beforeEach(async () => {
	world = await createWorld();
	installRecorders();
	configurePackages();
});

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

describe("a listing never installs a package", () => {
	test("the recorders do see the installs Pi makes when nothing stops it", async () => {
		await reloadLoader();
		const made = installs();
		expect(made.some((line) => line.startsWith("npm") && line.includes("missing-user-package"))).toBe(true);
		expect(made.some((line) => line.startsWith("git clone") && line.includes("missing-user-repo"))).toBe(true);
		expect(made.some((line) => line.includes("missing-project-package"))).toBe(true);
		expect(made.some((line) => line.includes("missing-project-repo"))).toBe(true);
	});

	test("listing commands runs no install and creates nothing, and still lists what is there", async () => {
		const settings = readFileSync(join(world.env.agentDir, "settings.json"), "utf8");
		const listed = await new PiCommandLister(sources()).list({ cwd: world.env.cwd });
		expect(listed.status === "accepted" && listed.commands.map((command) => command.id)).toEqual(["prompt:review"]);
		onlyGlobalRootProbes();
		for (const dir of [
			join(world.env.agentDir, "npm"),
			join(world.env.agentDir, "git"),
			join(world.env.cwd, ".pi", "npm"),
			join(world.env.cwd, ".pi", "git"),
		]) {
			expect(existsSync(dir)).toBe(false);
		}
		expect(readFileSync(join(world.env.agentDir, "settings.json"), "utf8")).toBe(settings);
	});

	test("a listing without a directory is as safe", async () => {
		await new PiCommandLister(sources()).list({ cwd: undefined });
		onlyGlobalRootProbes();
		expect(existsSync(join(world.env.agentDir, "npm"))).toBe(false);
	});

	test("leaves PI_OFFLINE as the process had it", async () => {
		expect(process.env.PI_OFFLINE).toBeUndefined();
		await new PiCommandLister(sources()).list({ cwd: world.env.cwd });
		expect(process.env.PI_OFFLINE).toBeUndefined();
		process.env.PI_OFFLINE = "no";
		await new PiCommandLister(sources()).list({ cwd: world.env.cwd });
		expect(process.env.PI_OFFLINE).toBe("no");
	});
});

describe("withoutPackageInstalls", () => {
	const target = () => {
		const settingsManager = settingsOf(world.env.cwd, world.env.agentDir);
		return { cwd: world.env.cwd, agentDir: world.env.agentDir, settingsManager };
	};

	test("with nothing missing, leaves PI_OFFLINE alone: a find or grep elsewhere can still fetch fd or rg", async () => {
		writeAgentFile(world.env, "settings.json", "{}");
		writeFile(join(world.env.cwd, ".pi", "settings.json"), "{}");
		const loaded = await withoutPackageInstalls(target(), async () => process.env.PI_OFFLINE);
		expect(loaded).toEqual({ value: undefined, missing: [] });
	});

	test("names what is missing, and is offline inside and restored outside, through a throw", async () => {
		await expect(
			withoutPackageInstalls(target(), async () => {
				expect(process.env.PI_OFFLINE).toBe("1");
				throw new Error("work failed");
			}),
		).rejects.toThrow("work failed");
		expect(process.env.PI_OFFLINE).toBeUndefined();
		const { missing } = await withoutPackageInstalls(target(), async () => "loaded");
		expect([...missing].sort()).toEqual([
			"git:github.com/example/missing-project-repo",
			"git:github.com/example/missing-user-repo",
			"npm:missing-project-package",
			"npm:missing-user-package",
		]);
		expect(installs()).toEqual([]);
	});

	test("overlapping callers stay offline until the last one is done", async () => {
		process.env.PI_OFFLINE = "false";
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered: () => void = () => {};
		const inside = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const first = withoutPackageInstalls(target(), () => {
			entered();
			return held;
		});
		await inside;
		const second = await withoutPackageInstalls(target(), async () => process.env.PI_OFFLINE);
		expect(second.value).toBe("1");
		expect(process.env.PI_OFFLINE).toBe("1");
		release();
		await first;
		expect(process.env.PI_OFFLINE).toBe("false");
	});

	test("passes the result through", async () => {
		expect((await withoutPackageInstalls(target(), async () => 42)).value).toBe(42);
	});
});
