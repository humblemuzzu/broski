/** Stop and the process's end (D8, D31), with receipts and failures the real CLI does not give on demand. */

import { afterEach, describe, expect, test } from "bun:test";
import { INTERRUPT_DEADLINE_MS } from "../../../backends/claude-code/live/shutdown";
import { FakeQuery } from "../helpers/fake-query";
import { FailingQuery } from "./helpers/failing-query";
import { flush, promptOf, sent, tempProject } from "./helpers/fake-host";
import { frame, idle, init, lifecycle, result, running } from "./helpers/frames";
import { fakeRig } from "./helpers/rig";

const projects: { remove: () => void }[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) project.remove();
});

async function hosted(query: FakeQuery) {
	const rig = fakeRig([query, new FakeQuery()]);
	const project = tempProject();
	projects.push(project);
	return { rig, query, live: await rig.openNew(project.dir) };
}

const abortedTurn = () =>
	result({ subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming" });

describe("Stop", () => {
	test("interrupts with cancelQueued, ends the run aborted when the CLI says so, and returns what was queued", async () => {
		const query = new FakeQuery({ interrupt: async () => ({ still_queued: [], cancelled: [] }) });
		const { rig, live } = await hosted(query);
		await live.control.prompt(promptOf("work"));
		await live.control.prompt(promptOf("steer", "steer"));
		await live.control.prompt(promptOf("later", "queue"));
		query.push(running(), init());
		await flush();
		expect((await live.control.abort()).status).toBe("accepted");
		expect(query.calls.find((call) => call.method === "interrupt")?.args).toEqual([{ cancelQueued: true }]);
		query.push(abortedTurn(), idle());
		await flush();
		expect(live.events().find((event) => event.type === "input_returned")).toEqual({
			type: "input_returned",
			texts: ["steer", "later"],
		});
		expect(live.events().at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		expect(live.reduced().queue).toEqual([]);
		expect((await sent(rig.sdk.started[0], 2)).map((m) => m.priority)).toEqual([undefined, "next"]);
		await rig.dispose();
	});

	test("a Stop with nothing running is accepted, silent and sends the CLI nothing", async () => {
		const query = new FakeQuery({ interrupt: async () => ({ still_queued: [] }) });
		const { rig, live } = await hosted(query);
		expect((await live.control.abort()).status).toBe("accepted");
		expect(query.calls.filter((call) => call.method === "interrupt")).toEqual([]);
		expect(live.events()).toEqual([]);
		await rig.dispose();
	});

	test("an interrupt the CLI never answers ends the process after the deadline, and the run ends aborted", async () => {
		const query = new FakeQuery({ interrupt: () => new Promise(() => undefined) });
		const { rig, live } = await hosted(query);
		await live.control.prompt(promptOf("work"));
		query.push(running());
		await flush();
		const started = Date.now();
		expect((await live.control.abort()).status).toBe("accepted");
		expect(Date.now() - started).toBeGreaterThanOrEqual(INTERRUPT_DEADLINE_MS - 100);
		await flush();
		expect(query.closed).toBe(true);
		expect(live.events().at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		await rig.dispose();
	}, 15_000);

	test("an interrupt that fails ends the process at once", async () => {
		const query = new FakeQuery({
			interrupt: async () => {
				throw new Error("control request aborted");
			},
		});
		const { rig, live } = await hosted(query);
		await live.control.prompt(promptOf("work"));
		query.push(running());
		await flush();
		expect((await live.control.abort()).status).toBe("accepted");
		await flush();
		expect(query.closed).toBe(true);
		expect(live.events().at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		await rig.dispose();
	});

	test("a Stop that reached the CLI ahead of its message is asked again once the turn begins, and only once", async () => {
		const query = new FakeQuery({ interrupt: async () => ({ still_queued: [], cancelled: [] }) });
		const { rig, live } = await hosted(query);
		const request = promptOf("work");
		await live.control.prompt(request);
		await live.control.abort();
		const asked = () => query.calls.filter((call) => call.method === "interrupt").length;
		expect(asked()).toBe(1);
		query.push(running(), lifecycle("started", request.clientRequestId), init());
		await flush();
		expect(asked()).toBe(2);
		query.push(frame({ type: "system", subtype: "hook_started" }), running());
		await flush();
		expect(asked()).toBe(2);
		query.push(abortedTurn(), idle());
		await flush();
		expect(live.events().at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		await rig.dispose();
	});

	test("a Stop that cancelled the only send before the CLI began it ends the run; one the CLI began does not", async () => {
		const first = promptOf("never began");
		const query = new FakeQuery({ interrupt: async () => ({ still_queued: [], cancelled: [first.clientRequestId] }) });
		const { rig, live } = await hosted(query);
		await live.control.prompt(first);
		await live.control.abort();
		query.push(lifecycle("cancelled", first.clientRequestId));
		await flush();
		expect(live.events().at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });

		const second = promptOf("began");
		await live.control.prompt(second);
		query.push(lifecycle("started", second.clientRequestId), running());
		await flush();
		await live.control.abort();
		query.push(lifecycle("cancelled", second.clientRequestId));
		await flush();
		expect(live.events().filter((event) => event.type === "run_finished")).toHaveLength(1);
		query.push(abortedTurn(), idle());
		await flush();
		expect(live.events().filter((event) => event.type === "run_finished")).toHaveLength(2);
		await rig.dispose();
	});
});

describe("the process ending under the host", () => {
	test("a stream that ends mid-run is an error outcome with a notice; asks expire; a prompt starts a new process", async () => {
		const { rig, query, live } = await hosted(new FakeQuery());
		await live.control.prompt(promptOf("work"));
		await live.control.prompt(promptOf("later", "queue"));
		query.push(running());
		query.end();
		await flush();
		expect(live.events().find((event) => event.type === "notice")).toMatchObject({
			level: "error",
			text: "Claude Code stopped",
		});
		expect(live.events().find((event) => event.type === "run_finished")).toMatchObject({
			outcome: { kind: "error", error: { code: "backend_unavailable" } },
		});
		expect(live.events().find((event) => event.type === "input_returned")).toEqual({
			type: "input_returned",
			texts: ["later"],
		});
		expect(rig.desk.expired).toBe(1);
		live.assertSettled();
		expect(await live.control.prompt(promptOf("again"))).toMatchObject({ status: "accepted", disposition: "started" });
		expect(rig.sdk.started).toHaveLength(2);
		await rig.dispose();
	});

	test("a stream that throws says why", async () => {
		const query = new FailingQuery();
		const { rig, live } = await hosted(query);
		query.push(running());
		await flush();
		query.failAfterNextFrame(new Error("Claude Code process exited with code 1"));
		query.push(frame({ type: "system", subtype: "hook_started" }));
		await flush();
		expect(live.events().find((event) => event.type === "notice")).toMatchObject({
			text: "Claude Code stopped: Claude Code process exited with code 1",
		});
		await rig.dispose();
	});
});

describe("prompts at the edges", () => {
	test("the same clientRequestId sent twice at once runs once", async () => {
		const { rig, live } = await hosted(new FakeQuery());
		const request = promptOf("once");
		const [a, b] = await Promise.all([live.control.prompt(request), live.control.prompt(request)]);
		expect(a).toEqual(b);
		expect(live.events().filter((event) => event.type === "run_started")).toHaveLength(1);
		expect((await sent(rig.sdk.started[0], 1)).length).toBe(1);
		await rig.dispose();
	});

	test("dispose closes the CLI and silences the sink", async () => {
		const { rig, query, live } = await hosted(new FakeQuery());
		await live.control.prompt(promptOf("work"));
		const before = live.recorder.items.length;
		await rig.live.dispose();
		query.push(running(), idle());
		await flush();
		expect(query.closed).toBe(true);
		expect(live.recorder.items.length).toBe(before);
		expect(await live.control.prompt(promptOf("too late"))).toMatchObject({ status: "rejected" });
	});
});
