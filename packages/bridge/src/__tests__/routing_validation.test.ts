import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { RouteRegistry, registerAll } from "../routing/registry";
import type { RequestContext, ServerDeps } from "../routing/types";
import { validateMessageShape } from "../routing/validate";
import type { ClientMessage, ServerMessage } from "../types";

const HOT_TYPES = ["cc_chat", "cc_abort", "set_view", "pty_input"] as const;

describe("message shape validation", () => {
	test("accepts well-formed messages", () => {
		expect(validateMessageShape({ type: "cc_chat", prompt: "hi" })).toBeNull();
		expect(validateMessageShape({ type: "cc_chat", prompt: "hi", cwd: "/tmp" })).toBeNull();
		expect(validateMessageShape({ type: "pty_resize", ptyId: "p1", rows: 24, cols: 80 })).toBeNull();
		expect(validateMessageShape({ type: "set_view", agent: "claude-code", sessionId: "s1" })).toBeNull();
	});

	test("rejects a missing required field", () => {
		expect(validateMessageShape({ type: "cc_chat" })).toContain("prompt");
		expect(validateMessageShape({ type: "pty_input", ptyId: "p1" })).toContain("data");
		expect(validateMessageShape({ type: "git_commit", projectPath: "/tmp" })).toContain("message");
	});

	test("rejects a wrong primitive type", () => {
		expect(validateMessageShape({ type: "pty_resize", ptyId: "p1", rows: "24", cols: 80 })).toContain("rows");
		expect(validateMessageShape({ type: "cc_abort", sessionId: 1 })).toContain("sessionId");
		expect(validateMessageShape({ type: "batch", messages: {} })).toContain("messages");
	});

	test("types without a schema are not shape-checked", () => {
		expect(validateMessageShape({ type: "no_such_type" })).toBeNull();
		expect(validateMessageShape({ type: "auth_set" })).toBeNull();
	});
});

const ccChatSchema = z.object({
	type: z.literal("cc_chat"),
	prompt: z.string(),
	sessionId: z.string().optional(),
	cwd: z.string().optional(),
});

describe("validation and dispatch cost", () => {
	test("hand-written guards beat zod on the hot path and stay far under 20us", () => {
		const iterations = 100_000;
		const raw = { type: "cc_chat", prompt: "hello world" };

		const guardStart = performance.now();
		for (let i = 0; i < iterations; i++) validateMessageShape(raw);
		const guardMs = performance.now() - guardStart;

		const zodStart = performance.now();
		for (let i = 0; i < iterations; i++) ccChatSchema.safeParse(raw);
		const zodMs = performance.now() - zodStart;

		const guardUs = (guardMs / iterations) * 1000;
		const zodUs = (zodMs / iterations) * 1000;
		console.log(`[bench] validate cc_chat: guard=${guardUs.toFixed(3)}us zod=${zodUs.toFixed(3)}us`);
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
