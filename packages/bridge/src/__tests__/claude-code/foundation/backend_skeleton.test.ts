/** The Step 3 skeleton: constructible, typed, honest about what is not built, and silent once disposed. */

import { describe, expect, test } from "bun:test";
import { claudeCodeBackendFactory } from "../../../backends/claude-code/factory";
import { CLAUDE_CODE_TRAITS, claudeCodeTraits } from "../../../backends/claude-code/traits";
import {
	type AgentBackend,
	BackendCallResult,
	BackendStatus,
	backendCapabilities,
	Capabilities,
	type CatalogEvent,
	ClaudeCodeOp,
} from "../../../contract";
import { exampleCall } from "../../../contract/testing/example-ops";
import { fakeClaudeSdk } from "../helpers/fake-claude-sdk";

const SESSION = crypto.randomUUID();

async function skeleton(customTools = false): Promise<{ backend: AgentBackend; events: CatalogEvent[] }> {
	const events: CatalogEvent[] = [];
	const factory = claudeCodeBackendFactory({
		cli: { found: false, reason: "not needed" },
		env: {},
		stateDir: "/nonexistent/claude-code-state",
		clientApp: "broski/test",
		sdk: fakeClaudeSdk(),
		...(customTools && { customTools: emptyCustomTools() }),
	});
	return { backend: await factory({ catalog: { emit: (event) => events.push(event) } }), events };
}

function emptyCustomTools() {
	return {
		sessionServers: async () => ({}),
		list: async () => [],
		read: async () => undefined,
		template: () => ({ toolId: "new", definition: {} }),
		save: async () => ({ ok: true as const }),
		remove: async () => false,
		test: async () => ({ ok: true, output: "" }),
	};
}

describe("the Claude Code skeleton", () => {
	test("declares valid capabilities, every op of ClaudeCodeOp, and call() with them", async () => {
		const { backend } = await skeleton(true);
		expect(Capabilities.safeParse(backendCapabilities(backend)).success).toBe(true);
		expect([...backend.traits.backendOps].sort()).toEqual(
			[...ClaudeCodeOp.options.map((op) => op.shape.kind.value)].sort(),
		);
		expect(backend.call).toBeDefined();
		expect(backendCapabilities(backend)).toMatchObject({ fork: true, rename: true, delete: true, archive: false });
	});

	test("leaves the custom tool ops out without the custom tools port", () => {
		expect(claudeCodeTraits({ customTools: false }).backendOps).not.toContain("custom_tools");
		expect(claudeCodeTraits({ customTools: true })).toBe(CLAUDE_CODE_TRAITS);
	});

	test("answers every op of its own as not built, another backend's as unsupported", async () => {
		const { backend } = await skeleton(true);
		const call = backend.call?.bind(backend);
		if (!call) throw new Error("no call()");
		for (const op of backend.traits.backendOps) {
			const made = exampleCall("claude-code", op, { sessionId: SESSION, itemId: SESSION, cwd: "/project" });
			if (!made) throw new Error(`no example call for ${op}`);
			const result = await call(made);
			expect(BackendCallResult.safeParse(result).success).toBe(true);
			expect(result.status === "rejected" && result.rejection.message).toContain("not built yet");
		}
		const foreign = await call({ backend: "pi", op: { kind: "refresh_models" } });
		expect(foreign.status === "rejected" && foreign.rejection.code).toBe("unsupported");
	});

	test("refuses another backend's sessions not_found and reports an honest status", async () => {
		const { backend } = await skeleton();
		const ref = { backend: "pi" as const, sessionId: SESSION };
		const reads = [
			await backend.getSession(ref),
			await backend.readTranscript(ref, { limit: 10 }),
			await backend.readAttachment(ref, "a"),
			await backend.open({ kind: "existing", session: ref }, { emit: () => undefined }),
		];
		for (const read of reads) expect(read.status === "rejected" && read.rejection.code).toBe("not_found");
		const status = await backend.status();
		expect(BackendStatus.safeParse(status).success).toBe(true);
		expect(status.usable).toBe(false);
	});

	test("dispose is idempotent and silences the catalog", async () => {
		const { backend, events } = await skeleton();
		await backend.dispose();
		await backend.dispose();
		expect(events).toEqual([]);
	});
});
