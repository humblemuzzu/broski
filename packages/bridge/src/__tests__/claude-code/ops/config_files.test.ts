/** `config_files` and `config_file`: the CLI's own locations, and a writer that never damages a file. */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ABSENT_REVISION, revisionOfText } from "../../../backends/claude-code/ops/file-state";
import type { BackendCallResult, ConfigFileEntry, EditableFile, EditableFileChange } from "../../../contract";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld;

afterEach(() => world.cleanup());

async function files(): Promise<ConfigFileEntry[]> {
	const result = await world.call({ kind: "config_files", cwd: world.cwd });
	if (result.status !== "accepted" || result.result.kind !== "config_files") throw new Error(JSON.stringify(result));
	return result.result.files;
}

async function file(
	fileId: string,
	options: { name?: string; change?: EditableFileChange } = {},
): Promise<BackendCallResult> {
	return world.call({ kind: "config_file", cwd: world.cwd, fileId, ...options });
}

function fileOf(result: BackendCallResult): EditableFile {
	if (result.status !== "accepted" || result.result.kind !== "config_file") throw new Error(JSON.stringify(result));
	return result.result.file;
}

function codeOf(result: BackendCallResult): string | undefined {
	return result.status === "rejected" ? result.rejection.code : undefined;
}

describe("config_files", () => {
	test("lists the CLI's real locations for the cwd, relative to the config dir", async () => {
		world = opsWorld();
		world.write(join(world.configDir, "settings.json"), "{}");
		world.write(join(world.cwd, ".mcp.json"), "{}");
		world.write(join(world.cwd, ".claude", "CLAUDE.md"), "# p");
		const listed = await files();
		const byId = new Map(listed.map((entry) => [entry.id, entry]));
		expect(byId.get("settings:user")).toMatchObject({
			path: join(world.configDir, "settings.json"),
			scope: "user",
			group: "Settings",
			exists: true,
			editable: true,
			format: "json",
			template: false,
		});
		expect(byId.get("settings:project")?.path).toBe(join(world.cwd, ".claude", "settings.json"));
		expect(byId.get("settings:local")).toMatchObject({
			path: join(world.cwd, ".claude", "settings.local.json"),
			exists: false,
		});
		expect(byId.get("mcp:project")).toMatchObject({ path: join(world.cwd, ".mcp.json"), exists: true });
		expect(byId.get("memory:user")?.path).toBe(join(world.configDir, "CLAUDE.md"));
		expect(byId.get("memory:project")?.path).toBe(join(world.cwd, "CLAUDE.md"));
		expect(byId.get("memory:local")?.path).toBe(join(world.cwd, "CLAUDE.local.md"));
		expect(byId.get("memory:project-claude-dir")).toMatchObject({
			path: join(world.cwd, ".claude", "CLAUDE.md"),
			exists: true,
		});
	});

	test("lists .claude/CLAUDE.md only when it exists, and nothing from ~/.claude/memory", async () => {
		world = opsWorld();
		world.write(join(world.configDir, "memory", "old.md"), "never read by the CLI");
		const listed = await files();
		expect(listed.some((entry) => entry.id === "memory:project-claude-dir")).toBe(false);
		expect(listed.some((entry) => entry.path.includes(`${join(world.configDir, "memory")}`))).toBe(false);
	});

	test("lists managed policy files read-only", async () => {
		world = opsWorld();
		const managed = (await files()).filter((entry) => entry.scope === "managed");
		if (process.platform !== "darwin" && process.platform !== "linux") return expect(managed).toEqual([]);
		expect(managed.map((entry) => entry.id).sort()).toEqual(["memory:managed", "settings:managed"]);
		expect(managed.every((entry) => !entry.editable)).toBe(true);
	});

	test("lists existing agents, commands, skills and output styles, and a place for each new one", async () => {
		world = opsWorld();
		world.write(join(world.cwd, ".claude", "agents", "reviewer.md"), "a");
		world.write(join(world.cwd, ".claude", "agents", "team", "qa.md"), "a");
		world.write(join(world.cwd, ".claude", "agents", "notes.txt"), "not an agent");
		world.write(join(world.configDir, "commands", "ship.md"), "c");
		world.write(join(world.cwd, ".claude", "skills", "lint", "SKILL.md"), "s");
		world.write(join(world.cwd, ".claude", "skills", "lint", "script.sh"), "resource");
		world.write(join(world.configDir, "output-styles", "terse.md"), "o");
		const listed = await files();
		const ids = listed.map((entry) => entry.id);
		expect(ids).toEqual(
			expect.arrayContaining([
				"agents:project/reviewer.md",
				"agents:project/team/qa.md",
				"commands:user/ship.md",
				"skills:project/lint/SKILL.md",
				"output-styles:user/terse.md",
			]),
		);
		expect(ids).not.toContain("agents:project/notes.txt");
		expect(ids).not.toContain("skills:project/lint/script.sh");
		const templates = listed.filter((entry) => entry.template).map((entry) => entry.id);
		expect(templates).toEqual(
			expect.arrayContaining([
				"agents:user",
				"agents:project",
				"commands:user",
				"commands:project",
				"skills:user",
				"skills:project",
				"output-styles:user",
				"output-styles:project",
				"auto-memory:project",
			]),
		);
		expect(listed.find((entry) => entry.id === "agents:project")).toMatchObject({
			path: join(world.cwd, ".claude", "agents"),
			exists: true,
			editable: true,
		});
	});

	test("finds auto memory where the CLI keeps it: projects/<every non-alphanumeric as ->/memory", async () => {
		world = opsWorld();
		const project = world.cwd.replace(/[^a-zA-Z0-9]/g, "-");
		world.write(join(world.configDir, "projects", project, "memory", "MEMORY.md"), "index");
		const listed = await files();
		expect(listed.find((entry) => entry.id === "auto-memory:project/MEMORY.md")).toMatchObject({
			path: join(world.configDir, "projects", project, "memory", "MEMORY.md"),
			group: "Memory",
			exists: true,
		});
	});

	test("a directory that is a link out of its base lists nothing and cannot be written", async () => {
		world = opsWorld();
		const outside = join(world.root, "elsewhere");
		world.write(join(outside, "stolen.md"), "x");
		mkdirSync(join(world.cwd, ".claude"), { recursive: true });
		symlinkSync(outside, join(world.cwd, ".claude", "agents"));
		const listed = await files();
		expect(listed.some((entry) => entry.id === "agents:project/stolen.md")).toBe(false);
		expect(listed.find((entry) => entry.id === "agents:project")).toMatchObject({ editable: false, exists: false });
	});
});

describe("config_file: reading", () => {
	test("reads a file with its revision, and a missing one as a starting point", async () => {
		world = opsWorld();
		world.write(join(world.configDir, "settings.json"), '{"model":"opus"}\n');
		const user = fileOf(await file("settings:user"));
		expect(user).toMatchObject({
			id: "settings:user",
			exists: true,
			text: '{"model":"opus"}\n',
			editable: true,
			truncated: false,
			problems: [],
		});
		expect(user.revision).toBe(revisionOfText('{"model":"opus"}\n'));
		const local = fileOf(await file("settings:local"));
		expect(local).toMatchObject({ exists: false, text: "{}\n", revision: ABSENT_REVISION, editable: true });
	});

	test("says why a settings file with a trailing comma is skipped, and never repairs it", async () => {
		world = opsWorld();
		const path = world.write(join(world.cwd, ".claude", "settings.json"), '{"permissions":{"allow":["Bash(ls)"],},}');
		const read = fileOf(await file("settings:project"));
		expect(read.problems.join(" ")).toContain("skips the whole file");
		expect(read.text).toBe('{"permissions":{"allow":["Bash(ls)"],},}');
		const refused = await file("settings:project", {
			change: { kind: "write", text: '{"permissions":{},}', revision: read.revision },
		});
		expect(codeOf(refused)).toBe("invalid_input");
		expect(readFileSync(path, "utf8")).toBe('{"permissions":{"allow":["Bash(ls)"],},}');
	});

	test("refuses ids it never named, names where none is taken, and names that are not file names", async () => {
		world = opsWorld();
		expect(codeOf(await file("conformance-no-such-file"))).toBe("not_found");
		expect(codeOf(await file("settings:nowhere"))).toBe("not_found");
		expect(codeOf(await file("settings:user/../../etc/passwd"))).toBe("not_found");
		expect(codeOf(await file("agents:project/../escape.md"))).toBe("not_found");
		expect(codeOf(await file("agents:project/.hidden.md"))).toBe("not_found");
		expect(codeOf(await file("settings:user", { name: "x" }))).toBe("invalid_input");
		expect(codeOf(await file("agents:project"))).toBe("invalid_input");
		expect(codeOf(await file("agents:project", { name: "../x" }))).toBe("invalid_input");
		expect(codeOf(await file("agents:project", { name: "a/b" }))).toBe("invalid_input");
		expect(codeOf(await file("agents:project/x.md", { name: "y" }))).toBe("invalid_input");
	});

	test("a template with a name answers the new file under its own id, with a starting text", async () => {
		world = opsWorld();
		const agent = fileOf(await file("agents:project", { name: "reviewer" }));
		expect(agent).toMatchObject({
			id: "agents:project/reviewer.md",
			exists: false,
			revision: ABSENT_REVISION,
			editable: true,
			format: "markdown",
		});
		expect(agent.path).toBe(join(world.cwd, ".claude", "agents", "reviewer.md"));
		expect(agent.text).toContain("name: reviewer");
		const skill = fileOf(await file("skills:user", { name: "lint.md" }));
		expect(skill.id).toBe("skills:user/lint/SKILL.md");
		expect(skill.path).toBe(join(world.configDir, "skills", "lint", "SKILL.md"));
		const command = fileOf(await file("commands:project", { name: "ship" }));
		expect(command.id).toBe("commands:project/ship.md");
	});

	test("a link that leaves the base is not read", async () => {
		world = opsWorld();
		const secret = world.write(join(world.root, "secret.txt"), "top secret");
		mkdirSync(join(world.cwd, ".claude"), { recursive: true });
		symlinkSync(secret, join(world.cwd, ".claude", "CLAUDE.md"));
		const read = fileOf(await file("memory:project-claude-dir"));
		expect(read).toMatchObject({ exists: false, editable: false, text: "" });
		expect(read.text).not.toContain("secret");
		expect(read.problems.join(" ")).toContain("outside");
	});
});

describe("config_file: writing", () => {
	test("creates a new agent at the id the template named, and the catalogue is invalidated", async () => {
		world = opsWorld();
		const named = fileOf(await file("agents:project", { name: "reviewer" }));
		const written = fileOf(
			await file(named.id, {
				change: { kind: "write", text: "---\nname: reviewer\n---\nhi\n", revision: named.revision },
			}),
		);
		expect(written).toMatchObject({ exists: true, text: "---\nname: reviewer\n---\nhi\n" });
		expect(readFileSync(join(world.cwd, ".claude", "agents", "reviewer.md"), "utf8")).toBe(
			"---\nname: reviewer\n---\nhi\n",
		);
		expect(world.invalidated).toEqual([world.cwd]);
	});

	test("a write at another revision is stale and changes nothing", async () => {
		world = opsWorld();
		const path = world.write(join(world.cwd, "CLAUDE.md"), "mine");
		const stale = await file("memory:project", {
			change: { kind: "write", text: "theirs", revision: revisionOfText("older") },
		});
		expect(codeOf(stale)).toBe("stale");
		expect(readFileSync(path, "utf8")).toBe("mine");
	});

	test("creating over a file that appeared meanwhile is stale", async () => {
		world = opsWorld();
		const read = fileOf(await file("memory:local"));
		world.write(join(world.cwd, "CLAUDE.local.md"), "appeared");
		const result = await file("memory:local", { change: { kind: "write", text: "mine", revision: read.revision } });
		expect(codeOf(result)).toBe("stale");
		expect(readFileSync(join(world.cwd, "CLAUDE.local.md"), "utf8")).toBe("appeared");
	});

	test("refuses JSON that does not parse, a non-object, and an .mcp.json whose servers are not an object", async () => {
		world = opsWorld();
		const path = world.write(join(world.cwd, ".mcp.json"), '{"mcpServers":{}}');
		const read = fileOf(await file("mcp:project"));
		for (const text of ["{", '{"a":1,}', "// c\n{}", "[]", "", '{"mcpServers":[]}']) {
			const refused = await file("mcp:project", { change: { kind: "write", text, revision: read.revision } });
			expect(codeOf(refused)).toBe("invalid_input");
		}
		expect(readFileSync(path, "utf8")).toBe('{"mcpServers":{}}');
		const ok = await file("mcp:project", {
			change: { kind: "write", text: '{"mcpServers":{"a":{"command":"x"}}}', revision: read.revision },
		});
		expect(fileOf(ok).text).toBe('{"mcpServers":{"a":{"command":"x"}}}');
	});

	test("writing back what was read answers the same text and does not touch the file", async () => {
		world = opsWorld();
		const path = world.write(join(world.configDir, "settings.json"), '{ "a" : 1 }\n');
		const before = readFileSync(path);
		const read = fileOf(await file("settings:user"));
		const kept = fileOf(
			await file("settings:user", { change: { kind: "write", text: read.text, revision: read.revision } }),
		);
		expect(kept.text).toBe(read.text);
		expect(readFileSync(path).equals(before)).toBe(true);
		expect(readdirSync(world.configDir)).toEqual(["settings.json"]);
	});

	test("never writes a managed file, a link out of the base, or a file too long to show", async () => {
		world = opsWorld();
		const managed = await file("settings:managed", {
			change: { kind: "write", text: "{}", revision: ABSENT_REVISION },
		});
		if (process.platform === "darwin" || process.platform === "linux") expect(codeOf(managed)).toBe("unsupported");
		const outside = world.write(join(world.root, "outside.json"), "{}");
		mkdirSync(join(world.cwd, ".claude"), { recursive: true });
		symlinkSync(outside, join(world.cwd, ".claude", "settings.json"));
		const link = await file("settings:project", { change: { kind: "write", text: "{}", revision: ABSENT_REVISION } });
		expect(codeOf(link)).toBe("unsupported");
		expect(readFileSync(outside, "utf8")).toBe("{}");
		const long = world.write(join(world.cwd, "CLAUDE.md"), "a".repeat(1_048_576 + 1));
		const view = fileOf(await file("memory:project"));
		expect(view).toMatchObject({ truncated: true, editable: false });
		const refused = await file("memory:project", { change: { kind: "write", text: "short", revision: view.revision } });
		expect(codeOf(refused)).toBe("unsupported");
		expect(readFileSync(long, "utf8").length).toBe(1_048_576 + 1);
	});

	test("keeps every other key of a settings file the phone does not touch, byte for byte of its own text", async () => {
		world = opsWorld();
		const text = '{\n\t"$schema": "x",\n\t"zeta": 1,\n\t"permissions": { "allow": ["Bash(ls)"] }\n}\n';
		world.write(join(world.configDir, "settings.json"), text);
		const read = fileOf(await file("settings:user"));
		const edited = text.replace("Bash(ls)", 'Bash(ls)", "Read');
		const result = fileOf(
			await file("settings:user", { change: { kind: "write", text: edited, revision: read.revision } }),
		);
		expect(result.text).toBe(edited);
		expect(JSON.parse(readFileSync(join(world.configDir, "settings.json"), "utf8")).zeta).toBe(1);
	});

	test("keeps the private mode of a file it replaces", async () => {
		world = opsWorld();
		const path = world.write(join(world.configDir, "settings.json"), "{}");
		chmodSync(path, 0o600);
		const read = fileOf(await file("settings:user"));
		await file("settings:user", { change: { kind: "write", text: '{"a":1}', revision: read.revision } });
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(readFileSync(path, "utf8")).toBe('{"a":1}');
	});
});

describe("config_file: deleting", () => {
	test("moves the file to the Trash at its revision and answers that it is gone", async () => {
		world = opsWorld();
		const path = world.write(join(world.cwd, ".claude", "agents", "old.md"), "bye");
		const read = fileOf(await file("agents:project/old.md"));
		const stale = await file(read.id, { change: { kind: "delete", revision: revisionOfText("other") } });
		expect(codeOf(stale)).toBe("stale");
		expect(existsSync(path)).toBe(true);
		const gone = fileOf(await file(read.id, { change: { kind: "delete", revision: read.revision } }));
		expect(gone).toMatchObject({ exists: false, revision: ABSENT_REVISION });
		expect(existsSync(path)).toBe(false);
		expect(world.trashed()).toEqual(["old.md"]);
		expect(world.invalidated).toEqual([world.cwd]);
	});

	test("a file that does not exist cannot be deleted, and a managed or unwritable one is unsupported", async () => {
		world = opsWorld();
		const missing = await file("memory:project", { change: { kind: "delete", revision: ABSENT_REVISION } });
		expect(codeOf(missing)).toBe("not_found");
		const managed = await file("settings:managed", { change: { kind: "delete", revision: ABSENT_REVISION } });
		if (process.platform === "darwin" || process.platform === "linux") expect(codeOf(managed)).toBe("unsupported");
		expect(world.trashed()).toEqual([]);
	});
});
