/**
 * Characterisation of queryClaudeCode's SDK options, permission (canUseTool) and
 * elicitation handling against a fake SDK query.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequestHandler, SdkOptions } from "../connectors/claude-code/query-context";
import { INIT_MESSAGE, resetClaudeCodeState, runQuery, uninstallFakeClaudeSdk } from "./fixtures/cc-query-harness";

type CanUseTool = NonNullable<SdkOptions["canUseTool"]>;
type CanUseToolContext = Parameters<CanUseTool>[2];

const SUGGESTIONS: PermissionUpdate[] = [
	{ type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" },
];

function sdkContext(overrides: Partial<CanUseToolContext> = {}): CanUseToolContext {
	return { signal: new AbortController().signal, toolUseID: "toolu_9", ...overrides };
}

async function installPermissionHandler(handler: PermissionRequestHandler): Promise<CanUseTool> {
	const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi", { onPermissionRequest: handler });
	const canUseTool = captured.options?.canUseTool;
	if (!canUseTool) throw new Error("canUseTool was not installed on the SDK options");
	return canUseTool;
}

beforeEach(() => {
	resetClaudeCodeState();
});
afterEach(() => {
	uninstallFakeClaudeSdk();
});

describe("queryClaudeCode permission handling", () => {
	test("forwards the request and maps a one-off allow", async () => {
		const requests: Parameters<PermissionRequestHandler>[0][] = [];
		const canUseTool = await installPermissionHandler(async (request) => {
			requests.push(request);
			return "once";
		});

		const result = await canUseTool(
			"Bash",
			{ command: "rm -rf /" },
			sdkContext({
				decisionReason: "needs approval",
				blockedPath: "/etc/passwd",
				suggestions: SUGGESTIONS,
				title: "Claude wants to run a command",
				displayName: "Run command",
				description: "desc",
				agentID: "agent-1",
			}),
		);

		expect(requests).toEqual([
			{
				sessionId: "ses_cc_1",
				toolUseId: "toolu_9",
				tool: "Bash",
				input: { command: "rm -rf /" },
				decisionReason: "needs approval",
				blockedPath: "/etc/passwd",
				hasSuggestions: true,
				suggestions: SUGGESTIONS,
				title: "Claude wants to run a command",
				displayName: "Run command",
				description: "desc",
				agentId: "agent-1",
			},
		]);
		expect(result).toEqual({
			behavior: "allow",
			updatedInput: { command: "rm -rf /" },
			toolUseID: "toolu_9",
			decisionClassification: "user_temporary",
		});
	});

	test("falls back to the tool input description when the SDK omits one", async () => {
		const requests: { description?: string }[] = [];
		const canUseTool = await installPermissionHandler(async (request) => {
			requests.push(request);
			return "once";
		});

		await canUseTool("Bash", { description: "from input" }, sdkContext());

		expect(requests[0]!.description).toBe("from input");
	});

	test("always-allow echoes the SDK suggestions as updatedPermissions", async () => {
		const canUseTool = await installPermissionHandler(async () => "always");

		const result = await canUseTool("Bash", { command: "ls" }, sdkContext({ suggestions: SUGGESTIONS }));

		expect(result).toEqual({
			behavior: "allow",
			updatedInput: { command: "ls" },
			updatedPermissions: SUGGESTIONS,
			toolUseID: "toolu_9",
			decisionClassification: "user_permanent",
		});
	});

	test("always-allow without suggestions emits no updatedPermissions", async () => {
		const canUseTool = await installPermissionHandler(async () => "always");

		const result = await canUseTool("Bash", { command: "ls" }, sdkContext());

		expect(result).toEqual({
			behavior: "allow",
			updatedInput: { command: "ls" },
			toolUseID: "toolu_9",
			decisionClassification: "user_permanent",
		});
	});

	test("honours updatedInput and updatedPermissions from the decision object", async () => {
		const canUseTool = await installPermissionHandler(async () => ({
			response: "always",
			updatedInput: { command: "safe" },
			updatedPermissions: SUGGESTIONS,
		}));

		const result = await canUseTool("Bash", { command: "ls" }, sdkContext());

		expect(result).toEqual({
			behavior: "allow",
			updatedInput: { command: "safe" },
			updatedPermissions: SUGGESTIONS,
			toolUseID: "toolu_9",
			decisionClassification: "user_permanent",
		});
	});

	test("reject and unrecognised responses deny with interrupt", async () => {
		const reject = await installPermissionHandler(async () => "reject");
		expect(await reject("Bash", { command: "ls" }, sdkContext())).toEqual({
			behavior: "deny",
			message: "User denied permission",
			interrupt: true,
			toolUseID: "toolu_9",
			decisionClassification: "user_reject",
		});

		const bogus = await installPermissionHandler(async () => "maybe" as never);
		expect(await bogus("Bash", { command: "ls" }, sdkContext())).toEqual({
			behavior: "deny",
			message: "User denied permission",
			interrupt: true,
			toolUseID: "toolu_9",
			decisionClassification: "user_reject",
		});
	});

	test("an aborted signal denies immediately without asking the app", async () => {
		let calls = 0;
		const canUseTool = await installPermissionHandler(async () => {
			calls += 1;
			return "once";
		});

		const controller = new AbortController();
		controller.abort();
		const result = await canUseTool("Bash", { command: "ls" }, sdkContext({ signal: controller.signal }));

		expect(result).toEqual({ behavior: "deny", message: "Session aborted", toolUseID: "toolu_9" });
		expect(calls).toBe(0);
	});
});

describe("queryClaudeCode elicitation handling", () => {
	test("forwards the request and maps accept content", async () => {
		const requests: Record<string, unknown>[] = [];
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi", {
			onElicitationRequest: async (request) => {
				requests.push(request);
				return { action: "accept", content: { name: "x" } };
			},
		});
		const onElicitation = captured.options?.onElicitation;
		if (!onElicitation) throw new Error("onElicitation was not installed on the SDK options");

		const result = await onElicitation(
			{
				serverName: "srv",
				message: "Authorize",
				mode: "url",
				url: "https://x",
				elicitationId: "e1",
				requestedSchema: { type: "object" },
			},
			{ signal: new AbortController().signal },
		);

		expect(requests[0]).toEqual({
			sessionId: "ses_cc_1",
			requestId: expect.stringMatching(/^[0-9a-f]{16}$/),
			mcpServerName: "srv",
			message: "Authorize",
			mode: "url",
			url: "https://x",
			elicitationId: "e1",
			requestedSchema: { type: "object" },
		});
		expect(result).toEqual({ action: "accept", content: { name: "x" } });
	});

	test("accept without content keeps the result content-free", async () => {
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi", {
			onElicitationRequest: async () => ({ action: "accept" }),
		});
		const onElicitation = captured.options?.onElicitation;
		if (!onElicitation) throw new Error("onElicitation was not installed on the SDK options");

		const result = await onElicitation(
			{ serverName: "srv", message: "Authorize" },
			{ signal: new AbortController().signal },
		);

		expect(result).toEqual({ action: "accept" });
	});

	test("declines when the app supplies no elicitation handler", async () => {
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi");
		const onElicitation = captured.options?.onElicitation;
		if (!onElicitation) throw new Error("onElicitation was not installed on the SDK options");

		const result = await onElicitation(
			{ serverName: "srv", message: "Authorize" },
			{ signal: new AbortController().signal },
		);

		expect(result).toEqual({ action: "decline" });
	});

	test("accept/decline/cancel from the app are passed through, anything else cancels", async () => {
		const decline = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi", {
			onElicitationRequest: async () => ({ action: "decline" }),
		});
		const declineHandler = decline.captured.options?.onElicitation;
		if (!declineHandler) throw new Error("onElicitation was not installed on the SDK options");
		expect(await declineHandler({ serverName: "s", message: "m" }, { signal: new AbortController().signal })).toEqual({
			action: "decline",
		});

		const cancel = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi", {
			onElicitationRequest: async () => ({ action: "bogus" as never }),
		});
		const cancelHandler = cancel.captured.options?.onElicitation;
		if (!cancelHandler) throw new Error("onElicitation was not installed on the SDK options");
		expect(await cancelHandler({ serverName: "s", message: "m" }, { signal: new AbortController().signal })).toEqual({
			action: "cancel",
		});
	});

	test("an aborted signal cancels without asking the app", async () => {
		let calls = 0;
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi", {
			onElicitationRequest: async () => {
				calls += 1;
				return { action: "accept" };
			},
		});
		const onElicitation = captured.options?.onElicitation;
		if (!onElicitation) throw new Error("onElicitation was not installed on the SDK options");

		const controller = new AbortController();
		controller.abort();
		const result = await onElicitation({ serverName: "s", message: "m" }, { signal: controller.signal });

		expect(result).toEqual({ action: "cancel" });
		expect(calls).toBe(0);
	});
});

describe("queryClaudeCode SDK option building", () => {
	test("applies config defaults, checkpointing env and the legacy variant thinking fallback", async () => {
		resetClaudeCodeState({
			systemPrompt: { type: "preset", preset: "claude_code", append: "extra" },
		});
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo", variant: "high" }, "hi");
		const options = captured.options;
		if (!options) throw new Error("query options were not captured");

		expect(options.model).toBe("sonnet");
		expect(options.permissionMode).toBe("default");
		expect(options.allowedTools).toEqual(["Read", "Bash"]);
		expect(options.disallowedTools).toEqual([]);
		expect(options.includePartialMessages).toBe(true);
		expect(options.settingSources).toEqual(["project", "local", "user"]);
		expect(options.enableFileCheckpointing).toBe(true);
		expect(options.extraArgs).toEqual({ "replay-user-messages": null });
		expect(options.env?.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING).toBe("1");
		expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "extra" });
		expect(options.thinking).toEqual({ type: "enabled", budgetTokens: 65536 });
		expect(options.abortController).toBeInstanceOf(AbortController);
	});

	test("resume, fork-on-resume and continue are mutually exclusive", async () => {
		const resumed = await runQuery(
			[INIT_MESSAGE],
			{ cwd: "/repo", sessionId: "ses_prev", resumeSessionAt: "msg-5", forkOnResume: true },
			"hi",
		);
		expect(resumed.captured.options?.resume).toBe("ses_prev");
		expect(resumed.captured.options?.resumeSessionAt).toBe("msg-5");
		expect(resumed.captured.options?.forkSession).toBe(true);

		const continued = await runQuery([INIT_MESSAGE], { cwd: "/repo", continueSession: true }, "hi");
		expect(continued.captured.options?.continue).toBe(true);
		expect(continued.captured.options?.resume).toBeUndefined();
	});

	test("bypassPermissions sets allowDangerouslySkipPermissions", async () => {
		resetClaudeCodeState({ permissionMode: "bypassPermissions" });
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi");
		expect(captured.options?.allowDangerouslySkipPermissions).toBe(true);
	});

	test("configured subagents become SDK agents and keep the Task tool available", async () => {
		resetClaudeCodeState({ subagents: [{ name: "Explore", description: "d", prompt: "p" }] });
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi");

		expect(captured.options?.allowedTools).toEqual(["Read", "Bash", "Task"]);
		expect(captured.options?.agents).toEqual({
			Explore: { description: "d", prompt: "p" },
		});
	});

	test("activeSubagent routes through the agent option when configured, else hints in the prompt", async () => {
		resetClaudeCodeState({ subagents: [{ name: "Explore", description: "d", prompt: "p" }] });

		const known = await runQuery([INIT_MESSAGE], { cwd: "/repo", activeSubagent: "Explore" }, "do it");
		expect(known.captured.options?.agent).toBe("Explore");
		expect(known.captured.prompt).toBe("do it");

		const unknown = await runQuery([INIT_MESSAGE], { cwd: "/repo", activeSubagent: "Ghost" }, "do it");
		expect(unknown.captured.options?.agent).toBeUndefined();
		expect(unknown.captured.prompt).toBe("Use the Ghost agent to handle this request.\n\ndo it");
	});

	test("disabling claude.ai MCP servers sets the env override", async () => {
		resetClaudeCodeState({ enableClaudeAiMcpServers: false });
		const { captured } = await runQuery([INIT_MESSAGE], { cwd: "/repo" }, "hi");
		expect(captured.options?.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
	});
});
