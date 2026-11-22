/**
 * Where terminal agents' hooks post: `/hook/<backend>`, with `/cc-terminal-hook` still Claude Code's, behind the
 * listener's bearer token and from this machine only.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { BackendId } from "../contract";
import { createClaudeCodeWiring } from "../server/claude-code-wiring";
import { createHookIngress, type HookHandler } from "../server/hook-ingress";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge, type TestEnv } from "./e2e/harness";
import { type ClaudeHome, createClaudeHome } from "./helpers/claude-home";
import { fetchFrom } from "./helpers/remote-fetch";

let env: TestEnv | undefined;
let claude: ClaudeHome | undefined;
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
	env?.restore();
	claude?.cleanup();
	env = undefined;
	claude = undefined;
	if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
});

const ASK = JSON.stringify({
	hook_event_name: "PermissionRequest",
	session_id: crypto.randomUUID(),
	transcript_path: "/nowhere.jsonl",
	cwd: "/nowhere",
	tool_name: "Bash",
	tool_input: { command: "ls" },
});

function recording(): { readonly handlers: Map<BackendId, HookHandler>; readonly reached: string[] } {
	const reached: string[] = [];
	const handler: HookHandler = async (request) => {
		reached.push(new URL(request.url).pathname);
		return Response.json({});
	};
	return { handlers: new Map([["claude-code", handler]]), reached };
}

function hookPost(path: string): Request {
	return new Request(`http://127.0.0.1:18274${path}`, { method: "POST", body: ASK });
}

describe("the hook ingress", () => {
	test("`/hook/claude-code` and `/cc-terminal-hook` reach Claude Code's receiver; others are refused", async () => {
		const { handlers, reached } = recording();
		const ingress = createHookIngress(handlers);
		expect((await ingress.handle(hookPost("/hook/claude-code"))).status).toBe(200);
		expect((await ingress.handle(hookPost("/cc-terminal-hook"))).status).toBe(200);
		expect(reached).toEqual(["/hook/claude-code", "/cc-terminal-hook"]);
		expect((await ingress.handle(hookPost("/hook/gemini"))).status).toBe(404);
		expect((await ingress.handle(hookPost("/hook/NOT_VALID"))).status).toBe(400);
		expect((await ingress.handle(hookPost("/hook/claude-code/more"))).status).toBe(400);
		expect(reached).toHaveLength(2);
		expect(ingress.owns("/hook/anything")).toBe(true);
		expect(ingress.owns("/hooks")).toBe(false);
	});

	test("refuses a hook from another machine, its token good or not", async () => {
		const { handlers, reached } = recording();
		const remote = fetchFrom("10.0.0.7", { hookIngress: createHookIngress(handlers) });
		const request = new Request("https://127.0.0.1:18274/hook/claude-code", {
			method: "POST",
			headers: { authorization: "Bearer bridge-token" },
			body: ASK,
		});
		expect((await remote(request))?.status).toBe(403);
		expect(reached).toEqual([]);
	});

	test(
		"a running bridge serves both of Claude Code's paths to its receiver behind the bridge's token",
		async () => {
			env = setupTestEnv();
			claude = createClaudeHome();
			process.env.CLAUDE_CONFIG_DIR = claude.configDir;
			const wiring = createClaudeCodeWiring({
				settings: { terminalAsks: true },
				cli: () => ({ ok: false, reason: "not needed", notes: [] }),
				version: "0.0.0-e2e",
				log: () => undefined,
			});
			const bridge = await startBridge({ claudeCode: wiring });
			try {
				const post = (path: string, headers: Record<string, string> = {}) =>
					fetch(`http://127.0.0.1:${bridge.port}${path}`, { method: "POST", headers, body: ASK });
				const authorized = { authorization: `Bearer ${bridge.token}` };
				expect((await post("/hook/claude-code")).status).toBe(401);
				for (const path of ["/hook/claude-code", "/cc-terminal-hook"]) {
					const answered = await post(path, authorized);
					expect(answered.status).toBe(200);
					expect(await answered.json()).toEqual({});
				}
				expect((await post("/hook/gemini", authorized)).status).toBe(404);
				expect((await post("/hook/NOT_VALID", authorized)).status).toBe(400);
			} finally {
				await bridge.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);
});
