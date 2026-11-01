import { describe, expect, test } from "bun:test";
import { handle, type UnifiedContext } from "../handlers/unified";
import type { UnifiedMessage } from "../routing/messages";

function rig() {
	const calls: string[] = [];
	const replies: Array<Record<string, unknown>> = [];
	const ctx: UnifiedContext = {
		claudeCode: {
			listProjects: async () => {
				calls.push("listProjects");
				return [{ id: "p" }];
			},
			listSessions: async () => {
				calls.push("listSessions");
				return [];
			},
			deleteSession: async () => {
				calls.push("deleteSession");
				return true;
			},
			abortClaudeCode: async () => {
				calls.push("abortClaudeCode");
			},
			getSupportedModels: async () => {
				calls.push("getSupportedModels");
				return [{ id: "sonnet" }];
			},
			listSkills: async () => {
				calls.push("listSkills");
				return [];
			},
		},
		log: () => {},
	};
	const reply = (message: Record<string, unknown>) => replies.push(message);
	return { calls, replies, ctx, reply };
}

const asMessage = (message: Record<string, unknown>) => message as unknown as UnifiedMessage;

describe("unified handlers answer only for the backend they serve", () => {
	test("a request naming another backend never reaches Claude Code", async () => {
		const { calls, replies, ctx, reply } = rig();
		await handle(asMessage({ type: "unified_list_models", backend: "pi", requestId: "r1" }), reply, ctx);
		await handle(
			asMessage({ type: "unified_delete_session", backend: "pi", sessionId: "s", requestId: "r2" }),
			reply,
			ctx,
		);
		await handle(asMessage({ type: "unified_abort", backend: "pi", sessionId: "s", requestId: "r3" }), reply, ctx);

		expect(calls).toEqual([]);
		expect(replies).toEqual([
			{ type: "unified_models", backend: "pi", data: [], requestId: "r1" },
			{ type: "unified_session_deleted", backend: "pi", data: false, requestId: "r2" },
			{ type: "unified_aborted", backend: "pi", data: false, requestId: "r3" },
		]);
	});

	test("a Claude Code request is served by Claude Code", async () => {
		const { calls, replies, ctx, reply } = rig();
		await handle(asMessage({ type: "unified_list_models", backend: "claude-code", requestId: "r1" }), reply, ctx);

		expect(calls).toEqual(["getSupportedModels"]);
		expect(replies).toEqual([
			{ type: "unified_models", backend: "claude-code", data: [{ id: "sonnet" }], requestId: "r1" },
		]);
	});
});
