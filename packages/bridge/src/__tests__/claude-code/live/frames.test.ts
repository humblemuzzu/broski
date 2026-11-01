/** What the host does with each frame of its CLI (D7, D8, D11, D12, D20, D30): driven through a `FakeQuery`. */

import { afterEach, describe, expect, test } from "bun:test";
import type { AgentEvent } from "../../../contract";
import { FakeQuery } from "../helpers/fake-query";
import { flush, promptOf, tempProject } from "./helpers/fake-host";
import {
	assistant,
	backgroundTasks,
	conversationReset,
	frame,
	idle,
	init,
	lifecycle,
	requiresAction,
	result,
	running,
	status,
	streamEvent,
	userEntry,
} from "./helpers/frames";
import { type FakeRig, fakeRig } from "./helpers/rig";
import { standInCatalogue } from "./helpers/stand-ins";

const projects: { remove: () => void }[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) project.remove();
});

async function hosted(
	options: Parameters<typeof fakeRig>[1] = {},
	query = new FakeQuery({ setModel: async () => undefined }),
) {
	const rig = fakeRig([query], options);
	const project = tempProject();
	projects.push(project);
	const live = await rig.openNew(project.dir);
	return { rig, query, live, project };
}

const types = (events: AgentEvent[]) => events.map((event) => event.type);

describe("run boundaries (D7)", () => {
	test("a turn nobody sent starts a system run on `running` and ends it on `idle`, completed", async () => {
		const { rig, query, live } = await hosted();
		query.push(running(), init(), assistant(), result(), idle());
		await flush();
		expect(types(live.events())).toEqual(["run_started", "run_finished"]);
		expect(live.events()[0]).toMatchObject({ trigger: "system" });
		expect(live.events()[1]).toMatchObject({ outcome: { kind: "completed" } });
		await rig.dispose();
	});

	test("a result alone ends nothing; several turns are one run; the first turn that failed decides", async () => {
		const { rig, query, live } = await hosted();
		query.push(
			running(),
			result(),
			result({ subtype: "error_during_execution", is_error: true, terminal_reason: "api_error" }),
		);
		await flush();
		expect(types(live.events())).toEqual(["run_started"]);
		query.push(result(), idle());
		await flush();
		expect(live.events().at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "error" } });
		expect(live.events().filter((event) => event.type === "run_started")).toHaveLength(1);
		await rig.dispose();
	});

	test("an idle with no run is ignored, and only `running` starts a run nobody sent: stray frames and an init do not", async () => {
		const { rig, query, live } = await hosted();
		query.push(idle());
		await flush();
		expect(live.events()).toEqual([]);
		query.push(streamEvent(), assistant(), init(), result());
		await flush();
		expect(live.events()).toEqual([]);
		expect(rig.mapping.mapped.length).toBeGreaterThan(0);
		query.push(running(), idle());
		await flush();
		expect(types(live.events())).toEqual(["run_started", "run_finished"]);
		await rig.dispose();
	});

	test("a part that fails while the run ends is a notice, and the run still finishes", async () => {
		const { rig, query, live } = await hosted();
		rig.mapping.failSettle = true;
		query.push(running(), idle());
		await flush();
		expect(types(live.events())).toEqual(["run_started", "notice", "run_finished"]);
		expect(live.events()[1]).toMatchObject({ level: "error", text: expect.stringContaining("the mapper is broken") });
		await rig.dispose();
	});

	test("requires_action does not end the run, and an ask is withdrawn with it", async () => {
		const { rig, query, live } = await hosted();
		query.push(running(), requiresAction(), running(), idle());
		await flush();
		expect(types(live.events())).toEqual(["run_started", "run_finished"]);
		expect(rig.desk.withdrawn).toHaveLength(1);
		await rig.dispose();
	});

	test("a run is settled, withdrawn and closed before run_finished, in that order", async () => {
		const { rig, query, live } = await hosted();
		rig.mapping.script((f) =>
			f.type === "system" && f.subtype === "init" ? [{ event: { type: "compaction_started", trigger: "auto" } }] : [],
		);
		query.push(running(), init(), idle());
		await flush();
		expect(types(live.events())).toEqual(["run_started", "compaction_started", "compaction_finished", "run_finished"]);
		expect(rig.mapping.settled).toEqual(["completed"]);
		expect(live.events()[2]).toMatchObject({ outcome: { kind: "failed" } });
		await rig.dispose();
	});

	test("a frame the mapper cannot handle is a notice, and the stream goes on", async () => {
		const { rig, query, live } = await hosted();
		rig.mapping.script((f) => {
			if (f.type === "assistant") throw new Error("boom");
			return [];
		});
		query.push(running(), assistant(), result(), idle());
		await flush();
		expect(live.events().find((event) => event.type === "notice")).toMatchObject({ level: "error" });
		expect(live.events().at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
		await rig.dispose();
	});
});

describe("the mode and the model the CLI reports (D11, D12)", () => {
	test("a mode in init or status is the session's mode, once", async () => {
		const { rig, query, live } = await hosted();
		query.push(
			running(),
			init({ permissionMode: "plan" }),
			status({ permissionMode: "plan" }),
			status({ permissionMode: "acceptEdits" }),
			idle(),
		);
		await flush();
		const modes = live.events().filter((event) => event.type === "mode_changed");
		expect(modes).toEqual([
			{ type: "mode_changed", axis: "permissions", value: "plan" },
			{ type: "mode_changed", axis: "permissions", value: "acceptEdits" },
		]);
		await rig.dispose();
	});

	test("a model the CLI runs on, named by its wire id, is shown by its listed id, once", async () => {
		const catalogue = standInCatalogue({ "claude-opus-5-5": "opus", "claude-sonnet-5-5": "sonnet" });
		const { rig, query, live } = await hosted({ catalogue });
		query.push(running(), init({ model: "claude-opus-5-5" }), init({ model: "claude-opus-5-5" }), idle());
		await flush();
		expect(live.events().filter((event) => event.type === "model_changed")).toEqual([
			{ type: "model_changed", modelId: "opus" },
		]);
		await rig.dispose();
	});

	test("a model chosen here is not undone by the report that follows it; a later change by the CLI is shown", async () => {
		const catalogue = standInCatalogue({ "claude-opus-5-5": "default", "claude-sonnet-5-5": "sonnet" });
		const { rig, query, live } = await hosted({ catalogue });
		await live.control.setModel("opus");
		query.push(running(), init({ model: "claude-opus-5-5" }), idle());
		await flush();
		expect(live.events().filter((event) => event.type === "model_changed")).toEqual([
			{ type: "model_changed", modelId: "opus" },
		]);
		query.push(running(), init({ model: "claude-sonnet-5-5" }), idle());
		await flush();
		expect(
			live
				.events()
				.filter((event) => event.type === "model_changed")
				.at(-1),
		).toEqual({ type: "model_changed", modelId: "sonnet" });
		await rig.dispose();
	});

	test("an unlisted wire model changes nothing", async () => {
		const { rig, query, live } = await hosted();
		query.push(running(), init({ model: "claude-made-up-9" }), idle());
		await flush();
		expect(live.events().some((event) => event.type === "model_changed")).toBe(false);
		await rig.dispose();
	});
});

describe("news for the parts around the host", () => {
	test("elicitation_complete reaches the desk, commands_changed the catalogue, a host's initialize the catalogue", async () => {
		const query = new FakeQuery({
			initializationResult: async () => JSON.parse(JSON.stringify({ claude_code_version: "2.1.316", models: [] })),
		});
		const { rig, live, project } = await hosted({}, query);
		query.push(
			running(),
			frame({ type: "system", subtype: "elicitation_complete", mcp_server_name: "s", elicitation_id: "e-1" }),
			frame({ type: "system", subtype: "commands_changed", commands: [] }),
			idle(),
		);
		await flush();
		expect(rig.desk.elicitationsCompleted).toEqual(["e-1"]);
		expect(rig.catalogue.invalidated).toEqual([project.dir]);
		expect(rig.catalogue.observed).toEqual([{ cwd: project.dir, version: "2.1.316" }]);
		expect(live.events().length).toBeGreaterThan(0);
		await rig.dispose();
	});

	test("background tasks are the host's tasks, with the statuses the task frames give, and finished ones go", async () => {
		const { rig, query, live } = await hosted();
		const task = (id: string, extra: object = {}) => ({
			task_id: id,
			task_type: "local_agent",
			description: `task ${id}`,
			...extra,
		});
		query.push(
			frame({ type: "system", subtype: "task_started", task_id: "a", tool_use_id: "toolu_a", description: "task a" }),
			backgroundTasks([task("a"), task("b"), task("c", { ambient: true })]),
		);
		await flush();
		const tasks = async () => {
			const listed = await rig.live.withLiveHost(live.ref.sessionId, async (host) => host?.tasks());
			return Array.isArray(listed) ? listed : [];
		};
		expect(await tasks()).toEqual([
			{ taskId: "a", description: "task a", status: "running", taskType: "local_agent", toolUseId: "toolu_a" },
			{ taskId: "b", description: "task b", status: "running", taskType: "local_agent" },
		]);
		query.push(frame({ type: "system", subtype: "task_updated", task_id: "b", patch: { status: "paused" } }));
		await flush();
		expect((await tasks()).map((t) => [t.taskId, t.status])).toEqual([
			["a", "running"],
			["b", "paused"],
		]);
		query.push(
			frame({
				type: "system",
				subtype: "task_notification",
				task_id: "a",
				status: "completed",
				output_file: "",
				summary: "",
			}),
		);
		await flush();
		expect((await tasks()).map((t) => t.taskId)).toEqual(["b"]);
		await rig.dispose();
	});
});

describe("the conversation going on under a new id (/clear)", () => {
	test("the session is replaced: the event, the registry's key, a new mapper, a new chain, a claim", async () => {
		const { rig, query, live } = await hosted();
		const old = live.ref.sessionId;
		const next = crypto.randomUUID();
		query.push(running(), conversationReset(next), result(), idle());
		await flush();
		expect(live.events().find((event) => event.type === "session_replaced")).toEqual({
			type: "session_replaced",
			session: { backend: "claude-code", sessionId: next },
		});
		expect(live.session.session.sessionId).toBe(next);
		expect(rig.live.isHosted(next)).toBe(true);
		expect(rig.live.isHosted(old)).toBe(false);
		expect(rig.mapping.seeds).toEqual([old, next]);
		expect(rig.ownership.claimed).toEqual([old, next]);
		expect(rig.live.row(next)).toMatchObject({ status: "idle" });
		const mark = live.recorder.items.length;
		await live.control.prompt(promptOf("after the clear"));
		expect(
			live
				.events()
				.slice(mark)
				.map((event) => event.type),
		).toEqual(["run_started", "user_message"]);
		expect(rig.store.rows.at(-1)).toMatchObject({ status: "running", cut: null });
		await rig.dispose();
	});

	test("a reset to the same id changes nothing", async () => {
		const { rig, query, live } = await hosted();
		query.push(running(), conversationReset(live.ref.sessionId), idle());
		await flush();
		expect(types(live.events())).toEqual(["run_started", "run_finished"]);
		await rig.dispose();
	});
});

describe("lifecycle frames (D8)", () => {
	test("a steered send is queued until the CLI starts it, then shown; a run's own send is not shown twice", async () => {
		const { rig, query, live } = await hosted();
		const first = promptOf("work");
		await live.control.prompt(first);
		const steer = promptOf("also this", "steer");
		await live.control.prompt(steer);
		expect(live.reduced().queue.map((item) => item.delivery)).toEqual(["steer"]);
		query.push(lifecycle("queued", first.clientRequestId), lifecycle("started", first.clientRequestId), running());
		await flush();
		expect(live.reduced().queue).toHaveLength(1);
		query.push(lifecycle("started", steer.clientRequestId), lifecycle("completed", steer.clientRequestId));
		await flush();
		expect(live.reduced().queue).toEqual([]);
		const shown = live.events().filter((event) => event.type === "user_message");
		expect(shown.map((event) => event.type === "user_message" && event.text)).toEqual(["work", "also this"]);
		await rig.dispose();
	});

	test("steered input the CLI never delivered goes back to the person when the run ends", async () => {
		const { rig, query, live } = await hosted();
		const steer = promptOf("never delivered", "steer");
		await live.control.prompt(promptOf("work"));
		await live.control.prompt(steer);
		query.push(running(), lifecycle("cancelled", steer.clientRequestId), result(), idle());
		await flush();
		expect(
			live
				.events()
				.slice(-3)
				.map((event) => event.type),
		).toEqual(["run_finished", "queue_changed", "input_returned"]);
		expect(live.events().at(-1)).toEqual({ type: "input_returned", texts: ["never delivered"] });
		expect(live.reduced().queue).toEqual([]);
		await rig.dispose();
	});

	test("an entry the CLI wrote is the cut of the run after it, and a subagent's entries are not", async () => {
		const { rig, query, live } = await hosted();
		const entry = crypto.randomUUID();
		query.push(
			running(),
			assistant(entry),
			userEntry(crypto.randomUUID(), { parent_tool_use_id: "toolu_1" }),
			assistant(crypto.randomUUID(), { agent_id: "a1" }),
			idle(),
		);
		await flush();
		await live.control.prompt(promptOf("next"));
		expect(rig.store.rows.at(-1)).toMatchObject({ status: "running", cut: entry });
		await rig.dispose();
	});
});
