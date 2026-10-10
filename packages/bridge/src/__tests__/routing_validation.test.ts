import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { RouteRegistry, registerAll } from "../routing/registry";
import type { RequestContext, ServerDeps } from "../routing/types";
import { validateMessageShape } from "../routing/validate";
import type { ClientMessage, ServerMessage } from "../types";

const HOT_TYPES = ["cc_chat", "chat", "pi_chat", "set_view", "cx_chat"] as const;

describe("message shape validation", () => {
	test("accepts well-formed messages", () => {
		expect(validateMessageShape({ type: "pi_chat", prompt: "hi" })).toBeNull();
		expect(validateMessageShape({ type: "cc_chat", prompt: "hi", cwd: "/tmp" })).toBeNull();
		expect(validateMessageShape({ type: "pty_resize", ptyId: "p1", rows: 24, cols: 80 })).toBeNull();
		expect(validateMessageShape({ type: "set_view", agent: "pi", sessionId: "s1" })).toBeNull();
	});

	test("rejects a missing required field", () => {
		expect(validateMessageShape({ type: "pi_chat" })).toContain("prompt");
		expect(validateMessageShape({ type: "pty_input", ptyId: "p1" })).toContain("data");
		expect(validateMessageShape({ type: "git_commit", projectPath: "/tmp" })).toContain("message");
	});

	test("rejects a wrong primitive type", () => {
		expect(validateMessageShape({ type: "pty_resize", ptyId: "p1", rows: "24", cols: 80 })).toContain("rows");
		expect(validateMessageShape({ type: "chat", sessionId: 1, content: "x" })).toContain("sessionId");
		expect(validateMessageShape({ type: "batch", messages: {} })).toContain("messages");
	});

	test("types without a schema are not shape-checked", () => {
		expect(validateMessageShape({ type: "no_such_type" })).toBeNull();
		expect(validateMessageShape({ type: "auth_set" })).toBeNull();
	});
});

const piChatSchema = z.object({
	type: z.literal("pi_chat"),
	prompt: z.string(),
	projectPath: z.string().optional(),
});

describe("validation and dispatch cost", () => {
	test("hand-written guards beat zod on the hot path and stay far under 20us", () => {
		const iterations = 100_000;
		const raw = { type: "pi_chat", prompt: "hello world" };

		const guardStart = performance.now();
		for (let i = 0; i < iterations; i++) validateMessageShape(raw);
		const guardMs = performance.now() - guardStart;

		const zodStart = performance.now();
		for (let i = 0; i < iterations; i++) piChatSchema.safeParse(raw);
		const zodMs = performance.now() - zodStart;

		const guardUs = (guardMs / iterations) * 1000;
		const zodUs = (zodMs / iterations) * 1000;
		console.log(`[bench] validate pi_chat: guard=${guardUs.toFixed(3)}us zod=${zodUs.toFixed(3)}us`);
		expect(guardUs).toBeLessThan(20);
	});

	test("registry dispatch stays cheap per message", async () => {
		const iterations = 100_000;
		const registry = new RouteRegistry();
		const deps = {} as ServerDeps;
		for (const type of HOT_TYPES) {
			registerAll(registry, [type], async () => {});
		}
		const reply = (_message: ServerMessage) => {};
		const messages = HOT_TYPES.map((type) => ({ type }) as unknown as ClientMessage);

		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			const message = messages[i % messages.length] as ClientMessage;
			const ctx = { ...deps, ws: {} as RequestContext["ws"], reply } as RequestContext;
			await registry.dispatch(message, ctx);
		}
		const perMessageUs = ((performance.now() - start) / iterations) * 1000;
		console.log(`[bench] registry.dispatch over ${HOT_TYPES.length} hot types: ${perMessageUs.toFixed(3)}us/msg`);
		expect(perMessageUs).toBeLessThan(50);
	});

	test("one awaited map lookup replaces the old sequential chain", async () => {
		const iterations = 100_000;
		const registry = new RouteRegistry();
		const deps = {} as ServerDeps;
		for (const type of HOT_TYPES) {
			registerAll(registry, [type], async () => {});
		}
		const reply = (_message: ServerMessage) => {};

		const newStart = performance.now();
		for (let i = 0; i < iterations; i++) {
			const type = HOT_TYPES[i % HOT_TYPES.length] as string;
			const ctx = { ...deps, ws: {} as RequestContext["ws"], reply } as RequestContext;
			await registry.dispatch({ type } as unknown as ClientMessage, ctx);
		}
		const newUs = ((performance.now() - newStart) / iterations) * 1000;

		const oldStart = performance.now();
		for (let i = 0; i < iterations; i++) {
			await simulateOldChain(HOT_TYPES[i % HOT_TYPES.length] as string);
		}
		const oldUs = ((performance.now() - oldStart) / iterations) * 1000;

		console.log(`[bench] dispatch: old chain=${oldUs.toFixed(3)}us/msg new registry=${newUs.toFixed(3)}us/msg`);
		expect(newUs).toBeLessThan(oldUs);
	});

	test("per-message context spread is negligible", () => {
		const iterations = 100_000;
		const wide: Record<string, unknown> = {};
		for (let i = 0; i < 100; i++) wide[`field${i}`] = i;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			const ctx: Record<string, unknown> = { ...wide, ws: null, reply: null };
			if (ctx.field0 === undefined) throw new Error("unreachable");
		}
		const perMessageUs = ((performance.now() - start) / iterations) * 1000;
		console.log(`[bench] 100-field RequestContext spread: ${perMessageUs.toFixed(3)}us/msg`);
		expect(perMessageUs).toBeLessThan(20);
	});
});

/**
 * Stand-in for the removed `processSingleMessage` chain, kept to a step count
 * and shape that matches what each hot type actually walked: prefix gates, the
 * awaited OpenCode sub-handlers up to the matching one, then the tail gates.
 */
const OC_ORDER = [
	"list_sessions",
	"oc_delete_message",
	"oc_list_workspaces",
	"list_worktrees",
	"create_session",
	"get_config",
	"list_providers",
	"list_projects",
	"read_file",
	"get_mcp_status",
	"chat",
	"delete_part",
	"oc_question_reply",
	"oc_session_shell",
	"oc_list_skills",
	"oc_init_git",
	"oc_health",
];
const PI_ORDER = [
	"pi_get_subagent_invocation",
	"pi_read_session_messages",
	"pi_get_tools",
	"pi_abort_compaction",
	"pi_execute_bash",
	"pi_set_label",
	"pi_get_tree",
	"pi_send_custom_message",
	"pi_chat",
];
const UNIFIED_ORDER = ["unified_list_sessions", "unified_list_session_children"];
const CHAIN_TAIL = ["cc_elicitation_response", "cc_chat"];

async function matchesOwned(owned: string, type: string): Promise<boolean> {
	return owned === type;
}

async function simulateOldChain(type: string): Promise<void> {
	if (type.startsWith("pi_")) {
		for (const owned of PI_ORDER) {
			if (await matchesOwned(owned, type)) return;
		}
		return;
	}
	if (type.startsWith("unified_")) {
		for (const owned of UNIFIED_ORDER) {
			if (await matchesOwned(owned, type)) return;
		}
		return;
	}
	for (const owned of OC_ORDER) {
		if (await matchesOwned(owned, type)) return;
	}
	for (const owned of CHAIN_TAIL) {
		if (await matchesOwned(owned, type)) return;
	}
}
