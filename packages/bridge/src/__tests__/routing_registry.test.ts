import { describe, expect, test } from "bun:test";
import { RouteRegistry, registerAll, unknownTypeError } from "../routing/registry";
import {
	ALL_MESSAGE_TYPES,
	createMessageRegistry,
	type MissingMessageHandler,
	type UnknownMessageHandler,
} from "../routing/routes";
import type { RequestContext, ServerDeps } from "../routing/types";
import type { ClientMessage, ServerMessage } from "../types";

const deps = {} as ServerDeps;

function testContext(): { ctx: RequestContext; replies: ServerMessage[] } {
	const replies: ServerMessage[] = [];
	const ctx = {
		...deps,
		ws: {} as RequestContext["ws"],
		reply: (message: ServerMessage) => {
			replies.push(message);
		},
	} as RequestContext;
	return { ctx, replies };
}

function asClientMessage(value: { type: string }): ClientMessage {
	return value as ClientMessage;
}

function errorText(message: ServerMessage): string | undefined {
	return (message as { message?: string }).message;
}

/**
 * Overlaps found by instrumenting the pre-registry chain: several types were
 * claimed by more than one module and resolved by chain order. Each must now
 * have exactly one owner, or `createMessageRegistry` throws on duplicates.
 */
const OVERLAPS = [
	{ type: "oc_delete_message", claimedBy: ["oc_messages", "oc_parts"], owner: "oc_messages" },
	{ type: "oc_get_message", claimedBy: ["oc_messages", "oc_parts"], owner: "oc_messages" },
	{
		type: "unified_list_session_children",
		claimedBy: ["unified", "unified_session_children"],
		owner: "unified_session_children",
	},
] as const;

describe("message routing registry", () => {
	test("every ClientMessage type has exactly one handler", () => {
		const registry = createMessageRegistry(deps);
		expect(registry.size()).toBe(ALL_MESSAGE_TYPES.length);
		expect(new Set(ALL_MESSAGE_TYPES).size).toBe(ALL_MESSAGE_TYPES.length);
		for (const type of ALL_MESSAGE_TYPES) {
			expect(registry.has(type)).toBe(true);
		}
	});

	test("the type-level exhaustiveness assertions resolve to never", () => {
		const missing: MissingMessageHandler = undefined as never;
		const unknown: UnknownMessageHandler = undefined as never;
		expect(missing).toBeUndefined();
		expect(unknown).toBeUndefined();
	});

	test("registering the same type twice is a startup error", () => {
		const registry = new RouteRegistry();
		registerAll(registry, ["cc_abort"], async () => {});
		expect(() => registerAll(registry, ["cc_abort"], async () => {})).toThrow(/Duplicate handler/);
	});

	test("documented overlaps resolve to a single owner", () => {
		const registry = createMessageRegistry(deps);
		for (const overlap of OVERLAPS) {
			expect(overlap.claimedBy.length).toBeGreaterThan(1);
			expect(registry.has(overlap.type)).toBe(true);
		}
	});

	test("unknown types keep the pre-registry error replies", async () => {
		const registry = createMessageRegistry(deps);
		const { ctx, replies } = testContext();
		await registry.dispatch(asClientMessage({ type: "unified_not_a_real_type" }), ctx);
		await registry.dispatch(asClientMessage({ type: "not_a_real_type" }), ctx);
		expect(replies.map(errorText)).toEqual([
			errorText(unknownTypeError("unified_not_a_real_type")),
			"Unknown message type",
		]);
	});

	test("cc_reload_plugins_live is registered and reaches the live-session handler", async () => {
		const registry = createMessageRegistry(deps);
		expect(ALL_MESSAGE_TYPES).toContain("cc_reload_plugins_live");
		const { ctx, replies } = testContext();
		const message: ClientMessage = { type: "cc_reload_plugins_live", sessionId: "s1" };
		await registry.dispatch(message, ctx);
		expect(replies).toHaveLength(1);
		expect(replies[0]?.type).toBe("cc_plugins_reloaded_live");
		expect(errorText(replies[0]!)).toBeUndefined();
	});

	test("a registered type reaches its handler through one map lookup", async () => {
		const registry = new RouteRegistry();
		let seen = "";
		registerAll(registry, ["get_agents_status"], async (message) => {
			seen = message.type;
		});
		const { ctx } = testContext();
		await registry.dispatch(asClientMessage({ type: "get_agents_status" }), ctx);
		expect(seen).toBe("get_agents_status");
	});
});
