import { describe, expect, test } from "bun:test";
import { mapClaudeCodeStreamToRuntimeEvent } from "../runtime/claude-code-runtime-event-mapper";
import { buildClaudeCodeRuntimeState } from "../runtime/claude-code-runtime-read-models";

describe("Runtime Abstraction", () => {
	test("Claude mapper emits common runtime events", () => {
		const started = mapClaudeCodeStreamToRuntimeEvent(
			{ type: "session-created", sessionId: "cc-1", agent: "claude-code", model: "sonnet" },
			{ backend: "claude-code", cwd: "/tmp/repo" },
		);
		expect(started?.type).toBe("agent_started");
		expect(started?.sessionId).toBe("cc-1");

		const permission = mapClaudeCodeStreamToRuntimeEvent(
			{
				type: "permission-request",
				sessionId: "cc-1",
				toolUseId: "tool-1",
				tool: "Bash",
				input: { command: "ls" },
				description: "Allow Bash?",
			},
			{ backend: "claude-code", cwd: "/tmp/repo" },
		);
		expect(permission?.type).toBe("permission_requested");

		const finished = mapClaudeCodeStreamToRuntimeEvent(
			{ type: "result-complete", stopReason: "end_turn" },
			{ backend: "claude-code", sessionId: "cc-1", cwd: "/tmp/repo" },
		);
		expect(finished?.type).toBe("agent_finished");
	});

	test("runtime state builder marks Claude streaming state honestly", () => {
		const ccState = buildClaudeCodeRuntimeState({
			sessionId: "cc-1",
			cwd: "/tmp/repo",
			isStreaming: true,
			model: "sonnet",
		});
		expect(ccState.backend).toBe("claude-code");
		expect(ccState.isStreaming).toBeTrue();
	});
});
