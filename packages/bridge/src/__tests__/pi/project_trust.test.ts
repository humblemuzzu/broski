import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isProjectTrusted, settingsOf } from "../../backends/pi/project-settings";
import { writeFile } from "./catalogue_support";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";

let env: PiTestEnv;

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(() => {
	env.dispose();
});

const global = (settings: object) => writeFile(join(env.agentDir, "settings.json"), JSON.stringify(settings));
const trustFile = (content: string) => writeFile(join(env.agentDir, "trust.json"), content);
const needsTrust = (dir = env.cwd) =>
	writeFile(join(dir, ".pi", "settings.json"), JSON.stringify({ defaultModel: "p" }));

describe("isProjectTrusted", () => {
	test("a project with nothing that needs trust is trusted", () => {
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(true);
		trustFile(JSON.stringify({ [env.cwd]: false }));
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(true);
	});

	test("each kind of project resource needs trust", () => {
		const projects = [
			[".pi/settings.json", "{}"],
			[".pi/extensions/e.ts", ""],
			[".pi/skills/s/SKILL.md", ""],
			[".pi/prompts/p.md", ""],
			[".agents/skills/s/SKILL.md", ""],
		] as const;
		for (const [index, [path, content]] of projects.entries()) {
			const dir = join(env.root, `project-${index}`);
			writeFile(join(dir, path), content);
			expect(isProjectTrusted(dir, env.agentDir)).toBe(false);
		}
	});

	test("an undecided project follows defaultProjectTrust, and `ask` distrusts", () => {
		needsTrust();
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(false);
		for (const [setting, trusted] of [
			["always", true],
			["never", false],
			["ask", false],
		] as const) {
			global({ defaultProjectTrust: setting });
			expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(trusted);
		}
	});

	test("a remembered decision beats the default, for the project or its nearest ancestor", () => {
		needsTrust();
		global({ defaultProjectTrust: "always" });
		trustFile(JSON.stringify({ [env.cwd]: false }));
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(false);
		global({ defaultProjectTrust: "never" });
		trustFile(JSON.stringify({ [env.root]: true }));
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(true);
		trustFile(JSON.stringify({ [env.root]: true, [env.cwd]: false }));
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(false);
	});

	test("fails closed: a trust store Pi cannot read distrusts, whatever the default says", () => {
		needsTrust();
		global({ defaultProjectTrust: "always" });
		for (const broken of ["{ not json", "[]", JSON.stringify({ [env.cwd]: "yes" })]) {
			trustFile(broken);
			expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(false);
		}
	});

	test("only reads: the trust store is not written and no lock is left behind", () => {
		needsTrust();
		trustFile(JSON.stringify({ [env.cwd]: true }));
		const path = join(env.agentDir, "trust.json");
		const before = { text: readFileSync(path, "utf8"), mtime: statSync(path).mtimeMs };
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(true);
		expect({ text: readFileSync(path, "utf8"), mtime: statSync(path).mtimeMs }).toEqual(before);
		expect(existsSync(`${path}.lock`)).toBe(false);
	});

	test("creates no agent directory for a user who never ran Pi", () => {
		needsTrust();
		const absent = join(env.root, "never-ran-pi");
		expect(isProjectTrusted(env.cwd, absent)).toBe(false);
		expect(existsSync(absent)).toBe(false);
	});

	test("reads the decision through a lock a terminal holds, without waiting on it", () => {
		needsTrust();
		trustFile(JSON.stringify({ [env.cwd]: true }));
		mkdirSync(join(env.agentDir, "trust.json.lock"));
		const began = performance.now();
		expect(isProjectTrusted(env.cwd, env.agentDir)).toBe(true);
		expect(performance.now() - began).toBeLessThan(50);
	});
});

describe("settingsOf", () => {
	const projectDefault = (cwd: string | undefined) => settingsOf(cwd, env.agentDir).getDefaultModel();

	test("applies the project's settings over the global ones only when the project is trusted", () => {
		global({ defaultModel: "global" });
		needsTrust();
		expect(projectDefault(env.cwd)).toBe("global");
		trustFile(JSON.stringify({ [env.cwd]: true }));
		expect(projectDefault(env.cwd)).toBe("p");
	});

	test("without a directory it reads the global settings alone", () => {
		global({ defaultModel: "global" });
		needsTrust();
		trustFile(JSON.stringify({ [env.root]: true }));
		expect(projectDefault(undefined)).toBe("global");
	});

	test("a project with no project settings sees the global ones", () => {
		global({ defaultModel: "global" });
		expect(projectDefault(env.cwd)).toBe("global");
	});
});
