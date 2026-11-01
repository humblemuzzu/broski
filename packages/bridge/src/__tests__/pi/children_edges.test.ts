/**
 * The edges of children on their own: what counts as a sub-run, how a child's run ends when its call fails, which
 * feeds the bound lets go, and a scan of a session file that fails half way.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ChildFeeds } from "../../backends/pi/live/child-feeds";
import { subRunsOf } from "../../backends/pi/mapping/sub-runs";
import { readEntries } from "../../backends/pi/store/jsonl-reader";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { ToolChildren } from "../../backends/pi/store/tool-children";
import type { AgentEvent, SessionSummary } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, textBlock, toolCall, writeSession } from "./store_fixtures";

const user = { role: "user", content: [{ type: "text", text: "find it" }], timestamp: 1 };
const assistant = {
	role: "assistant",
	content: [{ type: "text", text: "found it" }],
	api: "faux",
	provider: "faux",
	model: "faux-1",
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
	stopReason: "stop",
	timestamp: 2,
};
const subagentDetails = { mode: "single", results: [{ agent: "scout", messages: [user, assistant] }] };

describe("a sub-run", () => {
	test("is a list of the messages a Pi agent emits, every one with its role and timestamp", () => {
		expect(subRunsOf(subagentDetails).map((run) => run.messages.map((message) => message.role))).toEqual([
			["user", "assistant"],
		]);
	});

	test("is not another tool's list of messages: chat history without timestamps, or anything else beside them", () => {
		expect(subRunsOf({ messages: [{ role: "user", content: "hi" }] })).toEqual([]);
		expect(subRunsOf({ messages: [user, { text: "a note" }] })).toEqual([]);
		expect(subRunsOf({ messages: [user, "and a string"] })).toEqual([]);
	});

	test("needs a message of pi-ai's shape; other roles in it are not shown", () => {
		const custom = { role: "custom", customType: "note", content: "x", display: true, timestamp: 3 };
		const noStop = { ...assistant, stopReason: undefined };
		expect(subRunsOf({ messages: [custom] })).toEqual([]);
		expect(subRunsOf({ messages: [noStop] })).toEqual([]);
		expect(subRunsOf({ messages: [custom, assistant] })[0]?.messages.map((message) => message.role)).toEqual([
			"assistant",
		]);
		const badResult = { role: "toolResult", toolCallId: "c", content: [], isError: "no", timestamp: 4 };
		expect(subRunsOf({ messages: [badResult] })).toEqual([]);
	});
});

const PARENT: SessionSummary = {
	session: { backend: "pi", sessionId: "parent" },
	updatedAt: 1,
	archived: false,
	status: "running",
	origin: "broski",
};

function feeds(): ChildFeeds {
	return new ChildFeeds({ parent: () => PARENT, now: () => 10, announce: () => undefined });
}

function finishedOf(children: ChildFeeds, piToolCallId: string, end: () => void): AgentEvent | undefined {
	const events: AgentEvent[] = [];
	children.open(piToolCallId, { emit: (record) => events.push(record.event) });
	end();
	return events.find((event) => event.type === "run_finished");
}

describe("a child's run", () => {
	test("ends in error when its call failed or was denied, aborted when it was aborted, completed only when it completed", () => {
		const children = feeds();
		const outcomes = (["failed", "denied", "aborted", "completed"] as const).map((outcome) => {
			children.link(outcome, "subagent", {}, subagentDetails);
			const finished = finishedOf(children, outcome, () => children.end(outcome, outcome));
			return finished?.type === "run_finished" ? finished.outcome.kind : undefined;
		});
		expect(outcomes).toEqual(["error", "error", "aborted", "completed"]);
	});

	test("still running is never let go for newer children, so its call still ends it", () => {
		const children = feeds();
		children.link("oldest", "subagent", {}, subagentDetails);
		for (let n = 0; n < 300; n++) {
			children.link(`call-${n}`, "subagent", {}, subagentDetails);
			children.end(`call-${n}`, "completed");
		}
		expect(children.row("parent:oldest")).toMatchObject({ status: "running" });
		const finished = finishedOf(children, "oldest", () => children.end("oldest", "completed"));
		expect(finished).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
		expect(children.row("parent:call-0")).toBeUndefined();
	});
});

describe("the children of a session file", () => {
	let env: PiTestEnv;

	beforeEach(() => {
		env = createPiTestEnv();
	});

	afterEach(() => {
		env.dispose();
	});

	test("are each found once when a read fails part way through the file and the next scan reads it again", async () => {
		const builder = new SessionBuilder({ id: "p", cwd: env.cwd, version: 3, createdAt: 0 });
		builder.user("go", 1);
		for (let n = 0; n < 100; n++) {
			builder.assistant([textBlock("calling"), toolCall(`call-${n}`, "subagent", { task: `task ${n}` })], 10 + n);
			builder.toolResult(`call-${n}`, "done", 10 + n, "subagent", subagentDetails);
		}
		writeSession(env.sessionDir, builder);
		let batches = 0;
		const failing: typeof readEntries = async (file, spans) => {
			if (spans.length > 1) batches += 1;
			if (batches === 2) throw new Error("the disk went away");
			return readEntries(file, spans);
		};
		const children = new ToolChildren(new SessionIndex(piSessionDirs(env.agentDir)), failing);
		expect(await children.of("p").catch((error: Error) => error.message)).toBe("the disk went away");
		const found = await children.of("p");
		if ("status" in found) throw new Error(found.rejection.message);
		expect(found.children.map((child) => child.piToolCallId)).toEqual(
			Array.from({ length: 100 }, (_, n) => `call-${n}`),
		);
	});
});
