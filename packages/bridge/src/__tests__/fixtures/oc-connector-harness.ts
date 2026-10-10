/**
 * Fake OpenCode SDK client used by the connector characterisation tests. Records every
 * namespace.method call and returns canned `{ data }` payloads.
 */

import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { OpenCodeConnector } from "../../connectors/opencode";

export type RecordedCall = { name: string; args: unknown[] };

export function makeClient(calls: RecordedCall[], overrides: Record<string, unknown> = {}) {
	const fn = (name: string, data: unknown) => {
		return async (...args: unknown[]) => {
			calls.push({ name, args });
			if (data instanceof Error) throw data;
			return { data: typeof data === "function" ? (data as (...a: unknown[]) => unknown)(...args) : data };
		};
	};
	const client = {
		session: {
			list: fn("session.list", { data: [] }),
			create: fn("session.create", { id: "ses_new", title: "New", projectID: "p1", directory: "/repo" }),
			get: fn("session.get", { id: "ses_1", title: "Fetched", projectID: "p1", directory: "/repo" }),
			messages: fn("session.messages", [{ info: { role: "user", id: "m1" } }]),
			prompt: fn("session.prompt", { info: { id: "m2" } }),
			promptAsync: fn("session.promptAsync", { info: { id: "m3" } }),
			abort: fn("session.abort", true),
			diff: fn("session.diff", [{ file: "a.ts", additions: 1, deletions: 2 }]),
			delete: fn("session.delete", true),
			update: fn("session.update", { id: "ses_1", title: "renamed", projectID: "p1", directory: "/repo" }),
			fork: fn("session.fork", { id: "ses_child", title: "for", projectID: "p1", directory: "/repo" }),
			children: fn("session.children", [{ id: "ses_c1", title: "c1", projectID: "p1", directory: "/repo" }]),
			revert: fn("session.revert", { id: "ses_1", title: "rev", projectID: "p1", directory: "/repo" }),
			unrevert: fn("session.unrevert", { id: "ses_1", title: "unrev", projectID: "p1", directory: "/repo" }),
			share: fn("session.share", { id: "ses_1", title: "share", projectID: "p1", directory: "/repo" }),
			unshare: fn("session.unshare", { id: "ses_1", title: "unshare", projectID: "p1", directory: "/repo" }),
			summarize: fn("session.summarize", true),
			init: fn("session.init", true),
			status: fn("session.status", { ses_1: { type: "busy" }, ses_2: { type: "retry", attempt: 2 } }),
			todo: fn("session.todo", [{ content: "do it", status: "pending", priority: "high" }]),
			command: fn("session.command", { ok: true }),
			shell: fn("session.shell", { ok: true }),
			message: fn("session.message", { info: { id: "m1" } }),
			deleteMessage: fn("session.deleteMessage", true),
		},
		experimental: {
			session: { list: fn("experimental.session.list", { data: [] }) },
			resource: { list: fn("experimental.resource.list", { r1: { name: "res", uri: "file://x" } }) },
			workspace: {
				list: fn("experimental.workspace.list", [{ id: "ws_1" }]),
				create: fn("experimental.workspace.create", { id: "ws_2" }),
				remove: fn("experimental.workspace.remove", true),
			},
		},
		project: {
			list: fn("project.list", [{ id: "p1", name: "proj", worktree: "/repo", time: { created: 5 } }]),
			current: fn("project.current", { id: "p1" }),
			update: fn("project.update", { id: "p1" }),
			initGit: fn("project.initGit", { ok: true }),
		},
		file: {
			list: fn("file.list", [{ name: "a.ts", type: "file" }]),
			read: fn("file.read", { type: "text", content: "hello", mimeType: "text/plain" }),
			status: fn("file.status", [{ path: "a.ts", added: 1, removed: 2, status: "modified" }]),
		},
		find: {
			files: fn("find.files", ["src/a.ts", "src/B.ts"]),
			text: fn("find.text", [
				{
					path: { text: "src/a.ts" },
					line_number: 3,
					lines: { text: "needle" },
					submatches: [{ match: { text: "needle" }, start: 0, end: 6 }],
				},
			]),
			symbols: fn("find.symbols", [{ name: "fn", kind: 12, path: "src/a.ts", line: 1, column: 2 }]),
		},
		config: {
			providers: fn("config.providers", { providers: [] }),
			get: fn("config.get", { model: "sonnet" }),
			update: fn("config.update", { model: "opus" }),
		},
		provider: {
			list: fn("provider.list", {
				all: [
					{
						id: "anthropic",
						name: "Anthropic",
						models: {
							"claude-sonnet": {
								id: "claude-sonnet",
								name: "Sonnet",
								limit: { context: 200000 },
								cost: { input: 3, output: 15 },
							},
						},
					},
				],
				default: { anthropic: "claude-sonnet" },
				connected: ["anthropic"],
			}),
			auth: fn("provider.auth", { anthropic: [{ type: "api", label: "API key" }] }),
			oauth: {
				authorize: fn("provider.oauth.authorize", { url: "https://x", method: "code", instructions: "paste" }),
				callback: fn("provider.oauth.callback", true),
			},
		},
		auth: {
			set: fn("auth.set", true),
			remove: fn("auth.remove", true),
		},
		mcp: {
			status: fn("mcp.status", { srv: { status: "connected", tools: ["t"], resources: [] } }),
			add: fn("mcp.add", { srv: { status: "connected" } }),
			connect: fn("mcp.connect", true),
			disconnect: fn("mcp.disconnect", true),
			auth: {
				start: fn("mcp.auth.start", { authorizationUrl: "https://auth" }),
				callback: fn("mcp.auth.callback", { status: "connected" }),
				authenticate: fn("mcp.auth.authenticate", { status: "connected" }),
				remove: fn("mcp.auth.remove", true),
			},
		},
		pty: {
			list: fn("pty.list", [{ id: "pty_1", command: "bash", cwd: "/repo", status: "running" }]),
			create: fn("pty.create", { id: "pty_2", command: "zsh", cwd: "/repo", status: "running" }),
			get: fn("pty.get", { id: "pty_1", command: "bash", cwd: "/repo", status: "exited", exitCode: 0 }),
			update: fn("pty.update", { id: "pty_1", command: "bash", cwd: "/repo", status: "running" }),
			remove: fn("pty.remove", true),
		},
		lsp: { status: fn("lsp.status", [{ id: "ts", name: "TypeScript", status: "connected" }]) },
		instance: { dispose: fn("instance.dispose", true) },
		tool: {
			ids: fn("tool.ids", ["bash", "read"]),
			list: fn("tool.list", [{ id: "bash", description: "run" }]),
		},
		formatter: { status: fn("formatter.status", [{ name: "prettier", extensions: [".ts"], enabled: true }]) },
		vcs: {
			get: fn("vcs.get", { branch: "main", default_branch: "main" }),
			diff: fn("vcs.diff", [{ file: "a.ts", before: "x", after: "y", additions: 1, deletions: 1, status: "modified" }]),
		},
		command: { list: fn("command.list", [{ name: "build", source: "command", hints: ["a", 3] }]) },
		app: {
			agents: fn("app.agents", [{ name: "build", mode: "primary" }]),
			skills: fn("app.skills", [{ name: "skill", description: "d", location: "l", content: "c" }]),
		},
		question: {
			list: fn("question.list", [{ id: "q1" }]),
			reply: fn("question.reply", true),
			reject: fn("question.reject", true),
		},
		permission: {
			list: fn("permission.list", [{ id: "perm1" }]),
			reply: fn("permission.reply", true),
		},
		global: {
			health: fn("global.health", { healthy: true, version: "1.0" }),
			event: fn("global.event", { stream: (async function* () {})() }),
			config: {
				get: fn("global.config.get", { theme: "dark" }),
				update: fn("global.config.update", { theme: "light" }),
			},
		},
		worktree: {
			list: fn("worktree.list", ["/repo", "/repo-wt"]),
			create: fn("worktree.create", { name: "wt", branch: "main", directory: "/repo-wt" }),
			reset: fn("worktree.reset", true),
			remove: fn("worktree.remove", true),
		},
		path: { get: fn("path.get", { home: "/Users/x" }) },
		part: {
			delete: fn("part.delete", true),
			update: fn("part.update", { id: "part1" }),
		},
		...overrides,
	};
	return { client: client as unknown as OpencodeClient, calls };
}

export function makeConnector(overrides: Record<string, unknown> = {}) {
	const calls: RecordedCall[] = [];
	const { client } = makeClient(calls, overrides);
	const connector = new OpenCodeConnector({ client, baseUrl: "http://127.0.0.1:4096" });
	return { connector, calls, call: (name: string) => calls.filter((c) => c.name === name) };
}

export const sessionFixture = {
	id: "ses_1",
	slug: "happy-otter",
	title: "Hello",
	projectID: "proj_1",
	workspaceID: "ws_1",
	directory: "/repo",
	parentID: undefined,
	time: { created: 1, updated: 2 },
	summary: undefined,
	share: undefined,
	revert: undefined,
	permission: undefined,
};
