/**
 * Against the real bundled CLI (scripted endpoint, throwaway home, zero escapes): what the ops write is what the CLI
 * reads, the host calls they make do what they say, and the CLI's own `.claude.json` is written by the CLI alone.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { ActionList, BackendCallResult, ClaudeCodeOp } from "../../../contract";
import { createClaudeHome } from "../../helpers/claude-home";
import { installElicitServer } from "../conformance/elicit-server";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, startSpike } from "../spike/rig/session";
import { opsWorld } from "./ops-world";

expectNoOrphans();

const CLI_TEST_MS = 60_000;

function accepted(result: BackendCallResult) {
	if (result.status !== "accepted") throw new Error(JSON.stringify(result));
	return result.result;
}

function listOf(result: BackendCallResult): ActionList {
	const done = accepted(result);
	if (!("list" in done)) throw new Error(done.kind);
	return done.list;
}

async function write(world: ReturnType<typeof opsWorld>, fileId: string, text: string, name?: string): Promise<void> {
	const read = accepted(await world.call({ kind: "config_file", cwd: world.cwd, fileId, ...(name && { name }) }));
	if (read.kind !== "config_file") throw new Error(read.kind);
	const change = { kind: "write" as const, text, revision: read.file.revision };
	accepted(await world.call({ kind: "config_file", cwd: world.cwd, fileId: read.file.id, change }));
}

describe("what config_file writes is where the CLI reads it", () => {
	test(
		"a command, a skill, an agent, an output style, CLAUDE.md, project settings and .mcp.json all show up in a real session",
		async () => {
			const home = createClaudeHome({ git: true });
			installElicitServer(home.root, home.configDir);
			const world = opsWorld({ claudeHome: home });
			try {
				await write(world, "commands:project", "---\ndescription: Ship it\n---\n\nShip $ARGUMENTS\n", "ship");
				await write(
					world,
					"skills:user",
					"---\nname: lint\ndescription: Lint the project\n---\n\nRun the linter.\n",
					"lint",
				);
				await write(
					world,
					"agents:project",
					"---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\n",
					"reviewer",
				);
				await write(
					world,
					"output-styles:project",
					"---\nname: terse\ndescription: Short answers\n---\n\nBe terse.\n",
					"terse",
				);
				await write(world, "memory:project", "# Notes\nThe magic word is WOMBAT.\n");
				await write(world, "settings:local", JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }));
				const server = { type: "stdio", command: process.execPath, args: [join(home.root, "elicit-server.mjs")] };
				await write(world, "mcp:project", JSON.stringify({ mcpServers: { projsrv: server } }));
			} finally {
				await world.cleanup();
			}
			const spike = startSpike({ home, permissionMode: "default", turns: [{ text: ["ok"] }] });
			try {
				const init = await spike.q.initializationResult();
				const commands = (await spike.q.supportedCommands()).map((command) => command.name);
				expect(commands).toEqual(expect.arrayContaining(["ship", "lint"]));
				expect((await spike.q.supportedAgents()).map((agent) => agent.name)).toContain("reviewer");
				expect(init.available_output_styles).toContain("terse");
				await Bun.sleep(1_500);
				const usage = await spike.q.getContextUsage({ detail: "summary" });
				expect(usage.memoryFiles.map((file) => file.path)).toContain(join(home.projectDir, "CLAUDE.md"));
				const names = (await spike.q.mcpServerStatus()).map((status) => status.name);
				expect(names).toEqual(expect.arrayContaining(["projsrv", "elicit"]));
				expect(spike.server.escapes()).toEqual([]);
			} finally {
				await spike.close();
				home.cleanup();
			}
		},
		CLI_TEST_MS,
	);
});

describe("host calls against a real CLI", () => {
	function hosted(home: ReturnType<typeof createClaudeHome>, query: Query, extra: Parameters<typeof opsWorld>[0] = {}) {
		const sessionId = randomUUID();
		return { sessionId, world: opsWorld({ claudeHome: home, hosts: { [sessionId]: { query } }, ...extra }) };
	}

	test(
		"mcp_servers lists live status and toggles through the CLI, which writes its own .claude.json",
		async () => {
			const home = createClaudeHome({ git: true });
			installElicitServer(home.root, home.configDir);
			const spike = startSpike({ home, permissionMode: "default", turns: [{ text: ["ok"] }] });
			const { sessionId, world } = hosted(home, spike.q);
			const op = (change?: { rowId: string; actionId: string }): ClaudeCodeOp => ({
				kind: "mcp_servers",
				sessionId,
				...(change && { change }),
			});
			try {
				await spike.q.initializationResult();
				await Bun.sleep(1_500);
				const before = listOf(await world.call(op()));
				expect(before.rows.find((row) => row.id === "elicit")).toMatchObject({
					status: { label: "connected" },
					group: "User",
					actions: [{ id: "reconnect" }, { id: "disable" }],
				});
				const global = join(home.configDir, ".claude.json");
				const accountBefore = JSON.parse(readFileSync(global, "utf8"));
				const off = listOf(await world.call(op({ rowId: "elicit", actionId: "disable" })));
				expect(off.rows.find((row) => row.id === "elicit")).toMatchObject({
					status: { label: "disabled" },
					actions: [{ id: "enable" }],
				});
				const saved = JSON.parse(readFileSync(global, "utf8"));
				expect(saved.projects[home.projectDir].disabledMcpServers).toEqual(["elicit"]);
				expect(saved.machineID).toBe(accountBefore.machineID);
				expect(saved.mcpServers).toEqual(accountBefore.mcpServers);
				const on = listOf(await world.call(op({ rowId: "elicit", actionId: "enable" })));
				expect(on.rows.find((row) => row.id === "elicit")?.status?.label).not.toBe("disabled");
				expect(JSON.parse(readFileSync(global, "utf8")).projects[home.projectDir].disabledMcpServers).toEqual([]);
				expect(spike.server.escapes()).toEqual([]);
			} finally {
				await world.cleanup();
				await spike.close();
				home.cleanup();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"context_usage, session_settings and plugins answer from the real host and satisfy the contract",
		async () => {
			const home = createClaudeHome({ git: true });
			const spike = startSpike({ home, permissionMode: "default", turns: [{ text: ["ok"] }] });
			try {
				const init = await spike.q.initializationResult();
				const { sessionId, world } = hosted(home, spike.q, { init });
				try {
					const usage = listOf(await world.call({ kind: "context_usage", sessionId }));
					expect(usage.rows.some((row) => row.title === "System prompt")).toBe(true);
					expect(usage.note).toContain("claude-");
					const style = await world.call({
						kind: "session_settings",
						sessionId,
						change: { kind: "choice", key: "outputStyle", value: "Explanatory" },
					});
					const shown = accepted(style);
					expect(
						shown.kind === "session_settings" && shown.settings.find((setting) => setting.key === "outputStyle"),
					).toMatchObject({
						value: "Explanatory",
					});
					const saved = JSON.parse(readFileSync(join(home.projectDir, ".claude", "settings.local.json"), "utf8"));
					expect(saved.outputStyle).toBe("Explanatory");
					world.write(
						join(home.configDir, "settings.json"),
						JSON.stringify({ enabledPlugins: { "ghost@nowhere": true } }),
					);
					const plugins = listOf(
						await world.call({
							kind: "plugins",
							cwd: home.projectDir,
							sessionId,
							change: { rowId: "ghost@nowhere", actionId: "disable" },
						}),
					);
					expect(plugins.rows.find((row) => row.id === "ghost@nowhere")?.status?.label).toBe("disabled");
					expect(plugins.note).toMatch(/^Saved and reloaded in the running session/);
					expect(spike.server.escapes()).toEqual([]);
				} finally {
					await world.cleanup();
				}
			} finally {
				await spike.close();
				home.cleanup();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"rewind_files previews and restores the files a turn wrote, on the host's checkpoints",
		async () => {
			const home = createClaudeHome({ git: true });
			const spike = startSpike({
				home,
				permissionMode: "default",
				turns: [
					{ toolCalls: [{ name: "Write", args: { file_path: "notes.txt", content: "hi\n" } }] },
					{ text: ["Done."] },
				],
			});
			const sent = randomUUID();
			const { sessionId, world } = hosted(home, spike.q, {
				entryOf: async (_session, itemId) =>
					itemId === sent
						? { uuid: sent, type: "user" as const }
						: { status: "rejected" as const, rejection: { code: "not_found" as const, message: "no item" } },
			});
			try {
				spike.send("write the notes", { uuid: sent });
				await spike.waitFor((message) => message.type === "result");
				await spike.waitFor(isIdle);
				const notes = join(home.projectDir, "notes.txt");
				expect(existsSync(notes)).toBe(true);
				const preview = accepted(await world.call({ kind: "rewind_files", sessionId, userItemId: sent, dryRun: true }));
				expect(preview).toMatchObject({ kind: "rewind_files", canRewind: true });
				expect(preview.kind === "rewind_files" && preview.filesChanged).toEqual([notes]);
				expect(existsSync(notes)).toBe(true);
				const done = accepted(await world.call({ kind: "rewind_files", sessionId, userItemId: sent, dryRun: false }));
				expect(done).toMatchObject({ canRewind: true });
				expect(existsSync(notes)).toBe(false);
				expect(spike.server.escapes()).toEqual([]);
			} finally {
				await world.cleanup();
				await spike.close();
				home.cleanup();
			}
		},
		CLI_TEST_MS,
	);
});
