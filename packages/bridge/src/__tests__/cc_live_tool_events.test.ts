/**
 * A Claude Code tool call reaches the phone that prompted it while it runs: its arguments with the start and
 * its output with the finish. A phone that only lists sessions sees the start and nothing else.
 */

import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createLimits } from "../server/limits";
import { createLeveledLogger } from "../server/logger";
import { createBridgeState } from "../server/state";
import { createStreams } from "../server/streams";
import type { BroskiRuntimeEvent } from "../types/runtime";

type RecordingSocket = ServerWebSocket<unknown> & { received: BroskiRuntimeEvent[] };

function recordingSocket(): RecordingSocket {
	const received: BroskiRuntimeEvent[] = [];
	const socket = {
		data: {},
		received,
		getBufferedAmount: () => 0,
		send: (payload: string) => {
			const frame = JSON.parse(payload) as { type: string; data: BroskiRuntimeEvent };
			if (frame.type === "runtime_event") received.push(frame.data);
			return 1;
		},
	};
	return socket as unknown as RecordingSocket;
}

function newBridge() {
	const state = createBridgeState({
		opencode: null,
		auth: { version: 1, token: "cc-live-test", createdAt: Date.now() },
		webDistDir: "/tmp",
		defaultAgent: "claude-code",
		limits: createLimits(),
		logInfo: () => {},
	});
	const streams = createStreams({ state, log: createLeveledLogger({}), debugRts: false });
	return { state, streams };
}

describe("Claude Code tool events on the wire", () => {
	test("the socket that prompted gets the arguments with the start and the output with the finish", () => {
		const { state, streams } = newBridge();
		const owner = recordingSocket();
		state.sockets.add(owner);
		state.ccSessionOwners.set("cc-live", owner);

		streams.emitCcStream("cc-live", {
			type: "tool-call",
			tool: "Bash",
			toolUseId: "tu-1",
			status: "running",
			input: { command: "git status -sb" },
		});
		streams.emitCcStream("cc-live", {
			type: "tool-result",
			toolUseId: "tu-1",
			result: "## main...origin/main [ahead 6]",
		});

		const started = owner.received.find((event) => event.type === "tool_started");
		const finished = owner.received.find((event) => event.type === "tool_finished");
		expect(started).toMatchObject({ toolName: "Bash", toolCallId: "tu-1", input: { command: "git status -sb" } });
		expect(finished).toMatchObject({ toolCallId: "tu-1", output: "## main...origin/main [ahead 6]" });
	});

	test("a socket that only lists sessions sees the start, not the output", () => {
		const { state, streams } = newBridge();
		const owner = recordingSocket();
		const bystander = recordingSocket();
		state.sockets.add(owner);
		state.sockets.add(bystander);
		state.ccSessionOwners.set("cc-live", owner);

		streams.emitCcStream("cc-live", {
			type: "tool-call",
			tool: "Bash",
			toolUseId: "tu-1",
			status: "running",
			input: { command: "ls" },
		});
		streams.emitCcStream("cc-live", { type: "tool-result", toolUseId: "tu-1", result: "files" });

		expect(bystander.received.map((event) => event.type)).toEqual(["tool_started"]);
	});
});
