/**
 * Characterisation of OpenCodeConnector's config, provider, MCP, worktree and session-context
 * behaviour against a fake SDK client.
 */

import { describe, expect, test } from "bun:test";
import { makeConnector } from "./fixtures/oc-connector-harness";

describe("OpenCodeConnector config, providers and mcp", () => {
	test("listAllProviders maps models and cost", async () => {
		const { connector } = makeConnector();
		const providers = await connector.listAllProviders("/repo");
		expect(providers.connected).toEqual(["anthropic"]);
		expect(providers.default).toEqual({ anthropic: "claude-sonnet" });
		expect(providers.all[0]!.id).toBe("anthropic");
		expect(providers.all[0]!.models["claude-sonnet"]).toEqual({
			id: "claude-sonnet",
			name: "Sonnet",
			family: undefined,
			contextWindow: 200000,
			outputLimit: undefined,
			reasoning: undefined,
			attachment: undefined,
			toolCall: undefined,
			modalities: undefined,
			status: undefined,
			experimental: undefined,
			pricing: { input: 3, output: 15, cacheRead: undefined, cacheWrite: undefined },
			variants: undefined,
		});
	});

	test("updateModel delegates to config.update", async () => {
		const { connector, call } = makeConnector();
		await connector.updateModel("opus", "/repo");
		expect(call("config.update")[0]!.args).toEqual([{ directory: "/repo", config: { model: "opus" } }]);
	});

	test("getConfig and getGlobalConfig", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.getConfig("/repo")).toEqual({ model: "sonnet" });
		expect(await connector.getGlobalConfig()).toEqual({ theme: "dark" });
		expect(call("config.get")[0]!.args).toEqual([{ directory: "/repo" }]);
		expect(await connector.updateGlobalConfig({ model: "x" })).toEqual({ theme: "light" });
	});

	test("mcp status/add/auth flows", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.getMcpStatus("/repo")).toEqual({
			srv: { name: "srv", status: "connected", error: undefined, tools: ["t"], resources: [] },
		});
		expect(await connector.addMcp("srv", { type: "local" }, "/repo")).toEqual({
			srv: { name: "srv", status: "connected", error: undefined, tools: [], resources: [] },
		});
		expect(await connector.connectMcp("srv", "/repo")).toBe(true);
		expect(await connector.disconnectMcp("srv", "/repo")).toBe(true);
		expect(await connector.mcpAuthStart("srv", "/repo")).toEqual({ authorizationUrl: "https://auth" });
		expect(await connector.mcpAuthCallback("srv", "code", "/repo")).toBe(true);
		expect(await connector.mcpAuthAuthenticate("srv", "/repo")).toEqual({ status: "connected" });
		expect(await connector.mcpAuthRemove("srv", "/repo")).toBe(true);
		expect(call("mcp.auth.callback")[0]!.args).toEqual([{ name: "srv", directory: "/repo", code: "code" }]);
	});

	test("getMcpResources maps resources", async () => {
		const { connector } = makeConnector();
		expect(await connector.getMcpResources("/repo")).toEqual({
			r1: { name: "res", uri: "file://x", description: undefined, mimeType: undefined, client: "" },
		});
	});

	test("vcs, lsp, tools, formatter and agents", async () => {
		const { connector } = makeConnector();
		expect(await connector.getVcsInfo("/repo")).toEqual({ branch: "main", default_branch: "main" });
		expect(await connector.getVcsDiff("git", "/repo")).toEqual([
			{ file: "a.ts", before: "x", after: "y", additions: 1, deletions: 1, status: "modified" },
		]);
		expect(await connector.getLspStatus("/repo")).toEqual([
			{ id: "ts", name: "TypeScript", status: "running", root: undefined },
		]);
		expect(await connector.listToolIds("/repo")).toEqual(["bash", "read"]);
		expect(await connector.listTools("anthropic", "claude-sonnet", "/repo")).toEqual([
			{ id: "bash", description: "run", parameters: undefined },
		]);
		expect(await connector.getFormatterStatus("/repo")).toEqual([
			{ name: "prettier", extensions: [".ts"], enabled: true },
		]);
		expect(await connector.listAgents("/repo")).toEqual([
			{
				name: "build",
				description: undefined,
				color: undefined,
				mode: "primary",
				native: undefined,
				hidden: undefined,
				topP: undefined,
				temperature: undefined,
				permission: undefined,
				model: undefined,
				variant: undefined,
				prompt: undefined,
				options: undefined,
				steps: undefined,
			},
		]);
		expect(await connector.listCommands("/repo")).toEqual([
			{
				name: "build",
				description: undefined,
				source: "command",
				agent: undefined,
				model: undefined,
				template: undefined,
				subtask: false,
				hints: ["a"],
			},
		]);
		expect(await connector.listSdkSkills("/repo")).toEqual([
			{ name: "skill", description: "d", location: "l", content: "c" },
		]);
	});

	test("projects, worktrees, workspaces and misc", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.listProjects()).toEqual([
			{ id: "p1", name: "proj", path: "/repo", lastOpened: 5, icon: undefined },
		]);
		expect<unknown>(await connector.getCurrentProject("/repo")).toEqual({ id: "p1" });
		expect<unknown>(await connector.updateProject("p1", { name: "n", icon: { i: 1 } }, "/repo")).toEqual({
			id: "p1",
		});
		expect(await connector.initGit("/repo")).toEqual({ ok: true });
		expect(await connector.getPaths("/repo")).toEqual({ home: "/Users/x" });
		expect(await connector.getHealth()).toEqual({ healthy: true, version: "1.0" });
		expect(await connector.disposeInstance("/repo")).toBe(true);

		const worktrees = await connector.listWorktrees("/repo");
		expect(worktrees.map((w) => w.directory)).toEqual(["/repo", "/repo-wt"]);
		expect(await connector.createWorktree("wt", "bun dev", "/repo")).toEqual({
			name: "wt",
			branch: "main",
			directory: "/repo-wt",
		});
		expect(await connector.resetWorktree("wt", "/repo")).toBe(true);
		expect(await connector.deleteWorktree("wt", "/repo")).toBe(true);
		expect(call("worktree.reset")[0]!.args).toEqual([
			{ directory: "/repo", worktreeResetInput: { directory: "/repo/wt" } },
		]);

		expect<unknown>(await connector.listWorkspaces("/repo")).toEqual([{ id: "ws_1" }]);
		expect<unknown>(await connector.createWorkspace("ws_2", { branch: "main" }, "/repo")).toEqual({ id: "ws_2" });
		expect(await connector.removeWorkspace("ws_2", "/repo")).toBe(true);
	});

	test("auth, provider oauth and global config", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.authSet("anthropic", { type: "api", key: "k" } as never)).toBe(true);
		expect(await connector.authRemove("anthropic")).toBe(true);
		expect(await connector.getProviderAuth("/repo")).toEqual({
			anthropic: [
				{
					type: "api",
					label: "API key",
					name: undefined,
					description: undefined,
					url: undefined,
					prompts: undefined,
				},
			],
		});
		expect(await connector.providerOauthAuthorize("anthropic", 0, "/repo", { x: "y" })).toEqual({
			url: "https://x",
			method: "code",
			instructions: "paste",
		});
		expect(await connector.providerOauthCallback("anthropic", 0, "code", "/repo")).toBe(true);
		expect(call("provider.oauth.callback")[0]!.args).toEqual([
			{ providerID: "anthropic", directory: "/repo", method: 0, code: "code" },
		]);
	});

	test("getSessionContext aggregates tokens, lsp and diffs", async () => {
		const { connector } = makeConnector({
			session: {
				messages: async () => ({
					data: [
						{ info: { role: "user" } },
						{
							info: {
								role: "assistant",
								cost: 0.5,
								providerID: "anthropic",
								modelID: "claude-sonnet",
								tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 7, write: 3 }, total: 130 },
							},
						},
						{ info: { role: "assistant", cost: 0.25, tokens: { input: 0, output: 0 } } },
					],
				}),
				diff: async () => ({ data: [{ file: "a.ts", additions: 1, deletions: 2 }] }),
				list: async () => ({ data: [] }),
				status: async () => ({ data: {} }),
			},
			lsp: { status: async () => ({ data: [{ id: "ts", status: "connected" }] }) },
			provider: {
				list: async () => ({
					data: {
						all: [
							{ id: "anthropic", models: { "claude-sonnet": { id: "claude-sonnet", limit: { context: 150000 } } } },
						],
						default: {},
						connected: [],
					},
				}),
			},
		});

		expect(await connector.getSessionContext("ses_1", "/repo")).toEqual({
			tokens: {
				input: 100,
				output: 20,
				total: 130,
				contextTokens: 135,
				contextWindow: 150000,
				reasoning: 5,
				cacheRead: 7,
				cacheWrite: 3,
			},
			cost: 0.75,
			lsp: [{ id: "ts", name: "ts", status: "running", root: undefined }],
			modifiedFiles: [{ file: "a.ts", additions: 1, deletions: 2 }],
		});
	});
});
