/** D20: a subagent's events reach its child session, with a run of its own, and the parent's stream is untouched. */

import { afterEach, describe, expect, test } from "bun:test";
import { childRef } from "../../../backends/claude-code/ids";
import type { AgentEvent } from "../../../contract";
import { SessionRecorder } from "../../../contract/testing/conformance-harness";
import { FakeQuery } from "../helpers/fake-query";
import { flush, tempProject } from "./helpers/fake-host";
import { assistant, frame, idle, running } from "./helpers/frames";
import { fakeRig } from "./helpers/rig";

const projects: { remove: () => void }[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) project.remove();
});

const text = (blockId: string): AgentEvent[] => [
	{ type: "block_started", blockId, messageId: "m1", kind: "text" },
	{ type: "block_finished", blockId, text: "from the agent" },
];

async function hosted() {
	const query = new FakeQuery();
	const rig = fakeRig([query]);
	const project = tempProject();
	projects.push(project);
	const live = await rig.openNew(project.dir);
	rig.mapping.script((f) => {
		if (f.type !== "assistant" || !("agent_id" in f) || typeof f.agent_id !== "string") return [];
		const agentId = f.agent_id;
		return text("b1").map((event) => ({ event, agentId }));
	});
	return { rig, query, live };
}

const ref = (sessionId: string) => ({ backend: "claude-code" as const, sessionId });

function childOf(parent: string, agent: string): string {
	const child = childRef(parent, agent);
	if (!child) throw new Error("no child ref");
	return child;
}

describe("a subagent's child session", () => {
	test("follows the agent live: a run of its own around its events, none of them in the parent's stream", async () => {
		const { rig, query, live } = await hosted();
		const agent = "agent-1";
		const child = childOf(live.ref.sessionId, agent);
		const recorder = new SessionRecorder(2_000);
		const opened = await rig.live.openChild(ref(child), { parentId: live.ref.sessionId, agentId: agent }, recorder);
		if (opened.status === "rejected") throw new Error("rejected");
		expect(opened.snapshot).toEqual({ blocks: [], tools: [], interactions: [], queue: [], modes: [] });
		expect(opened.session.control).toBeUndefined();

		query.push(running(), assistant(crypto.randomUUID(), { agent_id: agent }));
		await flush();
		expect(rig.live.row(child)).toEqual({ status: "running" });
		expect(recorder.items.map((record) => record.event.type)).toEqual([
			"run_started",
			"block_started",
			"block_finished",
		]);
		expect(live.events().map((event) => event.type)).toEqual(["run_started"]);

		query.push(idle());
		await flush();
		expect(recorder.items.at(-1)?.event).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
		expect(rig.live.row(child)).toEqual({ status: "idle" });
		expect(opened.session.snapshot().lastOutcome).toEqual({ kind: "completed" });
		await opened.session.close();
		await rig.dispose();
	});

	test("ends with its task: stopped is aborted, and the parent's run goes on", async () => {
		const { rig, query, live } = await hosted();
		const agent = "agent-2";
		const child = childOf(live.ref.sessionId, agent);
		const recorder = new SessionRecorder(2_000);
		await rig.live.openChild(ref(child), { parentId: live.ref.sessionId, agentId: agent }, recorder);
		query.push(running(), assistant(crypto.randomUUID(), { agent_id: agent }));
		query.push(
			frame({
				type: "system",
				subtype: "task_notification",
				task_id: agent,
				status: "stopped",
				output_file: "",
				summary: "",
			}),
		);
		await flush();
		expect(recorder.items.at(-1)?.event).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		expect(live.reduced().run).toBeDefined();
		await rig.dispose();
	});

	test("opens as a static, empty session when its parent is not hosted, and not_found when the parent is unknown", async () => {
		const { rig, live } = await hosted();
		const parent = live.ref.sessionId;
		await live.close();
		await rig.live.end(parent);
		const child = childOf(parent, "agent-3");
		const opened = await rig.live.openChild(
			ref(child),
			{ parentId: parent, agentId: "agent-3" },
			{ emit: () => undefined },
		);
		expect(opened).toMatchObject({ status: "accepted", snapshot: { blocks: [] } });
		const unknown = crypto.randomUUID();
		const lost = childOf(unknown, "agent-3");
		expect(
			await rig.live.openChild(ref(lost), { parentId: unknown, agentId: "agent-3" }, { emit: () => undefined }),
		).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		await rig.dispose();
	});
});
