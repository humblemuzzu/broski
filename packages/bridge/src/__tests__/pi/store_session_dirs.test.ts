/** Where the store looks for sessions and where it puts new ones, as the `pi` command decides it. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { canonicalCwd, piSessionDirs } from "../../backends/pi/store/session-dir";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";

let env: PiTestEnv;

beforeEach(() => {
	env = createPiTestEnv();
	delete process.env.PI_CODING_AGENT_SESSION_DIR;
});

afterEach(() => {
	env.dispose();
});

function encoded(cwd: string): string {
	return `--${cwd.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
}

describe("the session directory of a cwd", () => {
	test("by default it is <agentDir>/sessions/--<cwd>--, and asking for it creates nothing", () => {
		const dirs = piSessionDirs(env.agentDir);
		const before = readdirSync(env.agentDir);

		expect(dirs.forCwd(env.cwd)).toBe(join(env.agentDir, "sessions", encoded(env.cwd)));
		expect(dirs.roots()).toEqual([{ dir: join(env.agentDir, "sessions"), nested: true, trusted: true }]);
		expect(dirs.toScan(env.cwd)).toEqual([]);
		expect(dirs.toScan(undefined)).toEqual([]);

		expect(readdirSync(env.agentDir)).toEqual(before);
		expect(existsSync(join(env.agentDir, "sessions"))).toBe(false);
	});

	test("the default directory is the one the SDK itself makes for a cwd, whatever the cwd looks like", () => {
		const dirs = piSessionDirs(env.agentDir);
		for (const cwd of [env.cwd, "/a-b", "/a/b/", "/with space/ü:x", "/a//b/../c", "/C:/odd\\name"]) {
			expect({ cwd, dir: dirs.forCwd(cwd) }).toEqual({ cwd, dir: SessionManager.create(cwd).getSessionDir() });
		}
	});

	test("a symlinked cwd is written under its real path, as a terminal in that directory would", () => {
		const link = join(env.root, "link-to-project");
		symlinkSync(env.cwd, link);
		const dirs = piSessionDirs(env.agentDir);

		expect(canonicalCwd(link)).toBe(env.cwd);
		expect(dirs.forCwd(link)).toBe(dirs.forCwd(env.cwd));
	});

	test("listing reads the directory of the cwd as given and as resolved, once each", () => {
		const link = join(env.root, "link-to-project");
		symlinkSync(env.cwd, link);
		const dirs = piSessionDirs(env.agentDir);
		const real = dirs.forCwd(env.cwd);
		const viaLink = join(env.agentDir, "sessions", encoded(link));
		mkdirSync(real, { recursive: true });
		mkdirSync(viaLink, { recursive: true });

		expect(dirs.toScan(link).sort()).toEqual([real, viaLink].sort());
		expect(dirs.toScan(env.cwd)).toEqual([real]);
	});

	test("with no cwd every directory under the sessions root is read, symlinks to directories included, files not", () => {
		const root = join(env.agentDir, "sessions");
		const a = join(root, "--a--");
		const target = join(env.root, "elsewhere-dir");
		mkdirSync(a, { recursive: true });
		mkdirSync(target);
		symlinkSync(target, join(root, "--linked--"));
		writeFileSync(join(root, "stray.jsonl"), "");

		expect(piSessionDirs(env.agentDir).toScan(undefined).sort()).toEqual([a, join(root, "--linked--")].sort());
	});

	test("PI_CODING_AGENT_SESSION_DIR names one flat directory for every cwd", () => {
		const dir = join(env.root, "flat-sessions");
		mkdirSync(dir);
		process.env.PI_CODING_AGENT_SESSION_DIR = dir;
		const dirs = piSessionDirs(env.agentDir);

		expect(dirs.forCwd(env.cwd)).toBe(dir);
		expect(dirs.forCwd(env.otherCwd)).toBe(dir);
		expect(dirs.toScan(env.cwd)).toEqual([dir]);
		expect(dirs.toScan(undefined)).toEqual([dir]);
		expect(dirs.roots()).toEqual([{ dir, nested: false, trusted: true }]);
	});

	test("~ in the variable is the home directory the runtime reports, as Pi's normalizePath expands it", () => {
		process.env.PI_CODING_AGENT_SESSION_DIR = "~/pi-sessions";
		expect(piSessionDirs(env.agentDir).forCwd(env.cwd)).toBe(join(homedir(), "pi-sessions"));
	});

	test("the sessionDir setting is used when the variable is not set", () => {
		const dir = join(env.root, "from-settings");
		mkdirSync(dir);
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ sessionDir: dir }));
		const dirs = piSessionDirs(env.agentDir);

		expect(dirs.forCwd(env.cwd)).toBe(dir);
		expect(dirs.toScan(undefined)).toEqual([dir]);
	});

	test("the variable wins over the setting", () => {
		const fromSettings = join(env.root, "from-settings");
		const fromEnv = join(env.root, "from-env");
		mkdirSync(fromSettings);
		mkdirSync(fromEnv);
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ sessionDir: fromSettings }));
		process.env.PI_CODING_AGENT_SESSION_DIR = fromEnv;

		expect(piSessionDirs(env.agentDir).forCwd(env.cwd)).toBe(fromEnv);
	});

	test("a project's own sessionDir counts for that cwd only, and a relative one means the project", () => {
		mkdirSync(join(env.cwd, ".pi"));
		writeFileSync(join(env.cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "sessions-here" }));
		const dirs = piSessionDirs(env.agentDir);

		expect(dirs.forCwd(env.cwd)).toBe(join(env.cwd, "sessions-here"));
		expect(dirs.forCwd(env.otherCwd)).toBe(join(env.agentDir, "sessions", encoded(env.otherCwd)));
		expect(dirs.roots()).toEqual([{ dir: join(env.agentDir, "sessions"), nested: true, trusted: true }]);
	});

	test("a cwd that does not exist still has a directory, from the path as given", () => {
		const missing = join(env.root, "gone", "project");
		expect(canonicalCwd(missing)).toBe(missing);
		expect(piSessionDirs(env.agentDir).forCwd(missing)).toBe(join(env.agentDir, "sessions", encoded(missing)));
	});

	test("a relative path means the working directory the settings were read for, as the pinned SDK writes it (variable, global setting, project setting)", async () => {
		const here = process.cwd();
		process.chdir(env.cwd);
		try {
			const scopes: Record<string, () => void> = {
				variable: () => {
					process.env.PI_CODING_AGENT_SESSION_DIR = "by-variable";
				},
				global: () => writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ sessionDir: "by-global" })),
				project: () => {
					mkdirSync(join(env.cwd, ".pi"), { recursive: true });
					writeFileSync(join(env.cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "by-project" }));
				},
			};
			for (const [scope, configure] of Object.entries(scopes)) {
				delete process.env.PI_CODING_AGENT_SESSION_DIR;
				rmSync(join(env.agentDir, "settings.json"), { force: true });
				rmSync(join(env.cwd, ".pi"), { recursive: true, force: true });
				configure();
				const raw =
					process.env.PI_CODING_AGENT_SESSION_DIR ?? SettingsManager.create(env.cwd, env.agentDir).getSessionDir();
				expect(raw).toBe(`by-${scope}`);

				const manager = SessionManager.create(env.cwd, raw);
				manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
				const written = manager.getSessionFile() ?? "";
				expect(written.startsWith(`by-${scope}/`)).toBe(true);
				expect(existsSync(join(env.cwd, written))).toBe(true);

				const dirs = piSessionDirs(env.agentDir);
				expect(dirs.forCwd(env.cwd)).toBe(join(env.cwd, `by-${scope}`));
				expect(dirs.toScan(env.cwd)).toEqual([join(env.cwd, `by-${scope}`)]);
			}
		} finally {
			process.chdir(here);
		}
	});

	test("a relative global directory is one directory per project: a listing of every cwd reads those of the projects it knows, and the default tree not at all", () => {
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ sessionDir: "pi-sessions" }));
		mkdirSync(join(env.agentDir, "sessions", "--stale--"), { recursive: true });
		mkdirSync(join(env.cwd, "pi-sessions"));
		const dirs = piSessionDirs(env.agentDir);

		expect(dirs.toScan(undefined)).toEqual([]);
		expect(dirs.roots()).toEqual([]);
		expect(dirs.know(env.cwd)).toBe(join(env.cwd, "pi-sessions"));
		expect(dirs.know(env.cwd)).toBeUndefined();
		expect(dirs.toScan(undefined)).toEqual([join(env.cwd, "pi-sessions")]);
		expect(dirs.roots()).toEqual([{ dir: join(env.cwd, "pi-sessions"), nested: false, trusted: true }]);
		expect(dirs.know(env.otherCwd)).toBe(join(env.otherCwd, "pi-sessions"));
		expect(dirs.toScan(undefined)).toEqual([join(env.cwd, "pi-sessions")]);
	});

	test("a project's own directory is known once asked about, is listed with every cwd from then on, and is forgotten when its setting goes", () => {
		const own = join(env.cwd, "own-sessions");
		mkdirSync(own);
		mkdirSync(join(env.cwd, ".pi"));
		writeFileSync(join(env.cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: own }));
		const dirs = piSessionDirs(env.agentDir);
		mkdirSync(join(env.agentDir, "sessions", "--a--"), { recursive: true });

		expect(dirs.toScan(undefined)).toEqual([join(env.agentDir, "sessions", "--a--")]);
		expect(dirs.know(env.cwd)).toBe(own);
		expect(dirs.toScan(undefined)).toEqual([join(env.agentDir, "sessions", "--a--"), own]);
		expect(dirs.roots().map((root) => root.dir)).toEqual([join(env.agentDir, "sessions"), own]);
		expect(dirs.know(env.otherCwd)).toBeUndefined();

		writeFileSync(join(env.cwd, ".pi", "settings.json"), JSON.stringify({}));
		expect(dirs.toScan(undefined)).toEqual([join(env.agentDir, "sessions", "--a--")]);
	});

	test("a project whose directory is the global one adds nothing", () => {
		const shared = join(env.root, "shared");
		mkdirSync(shared);
		process.env.PI_CODING_AGENT_SESSION_DIR = shared;
		const dirs = piSessionDirs(env.agentDir);

		expect(dirs.know(env.cwd)).toBeUndefined();
		expect(dirs.roots()).toEqual([{ dir: shared, nested: false, trusted: true }]);
	});

	test("the setting merges and parses as the pinned SettingsManager does it, without the lock files it writes", () => {
		const cases: { label: string; global?: string; project?: string }[] = [
			{ label: "global only", global: '{"sessionDir":"/g"}' },
			{ label: "project wins", global: '{"sessionDir":"/g"}', project: '{"sessionDir":"/p"}' },
			{ label: "project without the key", global: '{"sessionDir":"/g"}', project: '{"theme":"x"}' },
			{ label: "project null", global: '{"sessionDir":"/g"}', project: '{"sessionDir":null}' },
			{ label: "project empty", global: '{"sessionDir":"/g"}', project: '{"sessionDir":""}' },
			{ label: "project not json", global: '{"sessionDir":"/g"}', project: "{oops" },
			{ label: "global not json", global: "{oops", project: '{"sessionDir":"/p"}' },
			{ label: "bom", global: '\uFEFF{"sessionDir":"/g"}' },
			{ label: "tilde", global: '{"sessionDir":"~/in-home"}' },
			{ label: "relative", global: '{"sessionDir":"rel/dir"}', project: '{"sessionDir":"./also-rel"}' },
			{ label: "an array", global: "[1,2]" },
			{ label: "neither" },
		];
		for (const [index, { label, global, project }] of cases.entries()) {
			const agent = join(env.root, `agent-${index}`);
			const cwd = join(env.root, `project-${index}`);
			mkdirSync(agent);
			mkdirSync(join(cwd, ".pi"), { recursive: true });
			if (global !== undefined) writeFileSync(join(agent, "settings.json"), global);
			if (project !== undefined) writeFileSync(join(cwd, ".pi", "settings.json"), project);
			const raw = SettingsManager.create(cwd, agent).getSessionDir();
			const expected = raw ? resolve(cwd, raw) : join(agent, "sessions", encoded(cwd));

			expect({ label, dir: piSessionDirs(agent).forCwd(cwd) }).toEqual({ label, dir: expected });
		}
	});

	test("reading the settings leaves no lock file beside them", () => {
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ sessionDir: join(env.root, "x") }));
		mkdirSync(join(env.cwd, ".pi"));
		writeFileSync(join(env.cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "rel" }));
		const watched = [env.agentDir, join(env.cwd, ".pi")];
		const before = watched.map((dir) => readdirSync(dir).sort());
		const dirs = piSessionDirs(env.agentDir);

		for (let n = 0; n < 3; n += 1) {
			dirs.toScan(env.cwd);
			dirs.toScan(undefined);
			dirs.forCwd(env.cwd);
			dirs.know(env.cwd);
		}

		expect(watched.map((dir) => readdirSync(dir).sort())).toEqual(before);
	});

	test("a changed settings file is read again", () => {
		const dirs = piSessionDirs(env.agentDir);
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ sessionDir: join(env.root, "x") }));
		expect(dirs.forCwd(env.cwd)).toBe(join(env.root, "x"));
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ sessionDir: join(env.root, "yy") }));
		expect(dirs.forCwd(env.cwd)).toBe(join(env.root, "yy"));
	});
});
