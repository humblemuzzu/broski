/** `settings_overview`: the real cascade with provenance, policy marks, permission rules by source, and what is skipped. */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionList, ActionListRow, BackendCallResult } from "../../../contract";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld;

afterEach(() => world.cleanup());

function listOf(result: BackendCallResult): ActionList {
	if (result.status !== "accepted" || result.result.kind !== "settings_overview")
		throw new Error(JSON.stringify(result));
	return result.result.list;
}

function overview() {
	return world.call({ kind: "settings_overview", cwd: world.cwd });
}

function row(list: ActionList, id: string): ActionListRow | undefined {
	return list.rows.find((candidate) => candidate.id === id);
}

describe("settings_overview", () => {
	test("one row per effective setting with its tier, the account, and rules by source, highest tier first", async () => {
		world = opsWorld({
			init: { account: { email: "me@example.test", subscriptionType: "max", apiProvider: "firstParty" } },
		});
		world.write(
			join(world.configDir, "settings.json"),
			JSON.stringify({ model: "sonnet", permissions: { allow: ["Bash(ls)"], defaultMode: "plan" } }),
		);
		world.write(
			join(world.cwd, ".claude", "settings.json"),
			JSON.stringify({ language: "fr", permissions: { deny: ["Bash(rm *)"], allow: ["Read"] } }),
		);
		const list = listOf(await overview());
		expect(row(list, "setting:model")).toMatchObject({ subtitle: "sonnet", badges: ["user"], group: "Settings" });
		expect(row(list, "setting:language")).toMatchObject({ subtitle: "fr", badges: ["project"] });
		expect(row(list, "mode:default")).toMatchObject({ subtitle: "plan", group: "Permissions" });
		expect(row(list, "account:email")).toMatchObject({ subtitle: "me@example.test", group: "Account" });
		expect(row(list, "account:subscriptionType")?.subtitle).toBe("max");
		const rules = list.rows
			.filter((candidate) => candidate.id.startsWith("rule:"))
			.map((candidate) => [candidate.title, candidate.badges[0], candidate.status?.label]);
		expect(rules).toEqual([
			["Bash(rm *)", "project", "deny"],
			["Read", "project", "allow"],
			["Bash(ls)", "user", "allow"],
		]);
		expect(row(list, "rule:project:deny:0")?.status?.tone).toBe("error");
		expect(list.rows.every((candidate) => candidate.actions.length === 0)).toBe(true);
		expect(list.note).toContain("settings from 2 files");
	});

	test("never shows a secret: env and credentials by name only", async () => {
		world = opsWorld();
		world.write(
			join(world.configDir, "settings.json"),
			JSON.stringify({
				env: { ANTHROPIC_API_KEY: "sk-secret-1", PLAIN: "visible" },
				apiKeyHelper: "get-key.sh",
				hooks: { PreToolUse: [] },
			}),
		);
		const list = listOf(await overview());
		expect(row(list, "setting:env")?.subtitle).toBe("2: ANTHROPIC_API_KEY, PLAIN");
		expect(row(list, "setting:hooks")?.subtitle).toBe("1: PreToolUse");
		expect(JSON.stringify(list)).not.toContain("sk-secret-1");
	});

	test("marks what policy sets, with the origin of the policy", async () => {
		world = opsWorld({
			resolved: {
				effective: { model: "opus", language: "fr" },
				provenance: {
					model: { source: "managed", policyOrigin: "file", path: "/etc/claude-code/managed-settings.json" },
					language: { source: "user" },
				},
				sources: [
					{ source: "user", settings: { language: "fr" }, path: "/u/settings.json" },
					{
						source: "managed",
						settings: { model: "opus" },
						path: "/etc/claude-code/managed-settings.json",
						policyOrigin: "file",
					},
				],
			},
		});
		const list = listOf(await overview());
		expect(row(list, "setting:model")).toMatchObject({
			status: { label: "managed by policy", tone: "warning" },
			badges: ["managed (file)"],
		});
		expect(row(list, "setting:language")?.status).toBeUndefined();
	});

	test("lists a file Claude Code skips as a problem, and a repository's escalating default mode as ignored", async () => {
		world = opsWorld();
		world.write(join(world.cwd, ".claude", "settings.local.json"), '{"model":5}');
		world.write(
			join(world.cwd, ".claude", "settings.json"),
			JSON.stringify({ permissions: { defaultMode: "bypassPermissions" }, language: "fr" }),
		);
		const list = listOf(await overview());
		const problems = list.rows.filter((candidate) => candidate.group === "Problems");
		expect(problems.map((candidate) => candidate.title)).toEqual([
			"Local settings (this machine)",
			"Default permission mode ignored",
		]);
		expect(problems[0]?.status).toEqual({ label: "problem", tone: "error" });
		expect(problems[0]?.subtitle).toContain("settings schema");
		expect(row(list, "mode:default")).toBeUndefined();
	});

	test("a project's URL list that leaves out our terminal hook is a problem, and no file is changed", async () => {
		world = opsWorld();
		const url = "https://127.0.0.1:18274/cc-terminal-hook";
		const user = JSON.stringify({ hooks: { PermissionRequest: [{ matcher: "*", hooks: [{ type: "http", url }] }] } });
		const project = JSON.stringify({ allowedHttpHookUrls: ["https://hooks.example.com/*"] });
		const userFile = world.write(join(world.configDir, "settings.json"), user);
		const projectFile = world.write(join(world.cwd, ".claude", "settings.json"), project);
		const list = listOf(await overview());
		const blocked = list.rows.find((candidate) => candidate.title === "Terminal prompts blocked");
		expect(blocked?.group).toBe("Problems");
		expect(blocked?.subtitle).toContain("project settings");
		expect(blocked?.subtitle).toContain(url);
		expect([readFileSync(userFile, "utf8"), readFileSync(projectFile, "utf8")]).toEqual([user, project]);
	});

	test("a settings file that is not JSON is a problem, and the rest of the cascade still shows", async () => {
		world = opsWorld();
		world.write(join(world.cwd, ".claude", "settings.json"), '{"language":"fr",}');
		world.write(join(world.configDir, "settings.json"), '{"model":"opus"}');
		const list = listOf(await overview());
		expect(list.rows.find((candidate) => candidate.group === "Problems")?.subtitle).toContain("not valid JSON");
		expect(row(list, "setting:model")?.subtitle).toBe("opus");
	});

	test("an empty cascade is a list with no settings, not an error", async () => {
		world = opsWorld();
		const list = listOf(await overview());
		expect(list.rows.filter((candidate) => candidate.group === "Settings")).toEqual([]);
		expect(list.note).toContain("0 settings from 0 files");
	});
});
