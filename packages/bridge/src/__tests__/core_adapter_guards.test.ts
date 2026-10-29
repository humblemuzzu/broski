import { describe, expect, test } from "bun:test";
import type { AgentBackend, ModelsListResult, OpenResult, SessionSink } from "../contract";
import { validReply } from "../contract/testing/example-replies";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { REQUEST_DEADLINE_MS } from "../core/protocol-server";
import { changedSession, Gate, wrappingSessions } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig } from "./helpers/core-rig";

/** The fake, keeping every sink the core hands it, for records a real adapter might send at the wrong time. */
function keepingSinks(sinks: SessionSink[]): (backend: AgentBackend) => AgentBackend {
	return (backend) => ({
		...backend,
		open: (target, sink) => {
			sinks.push(sink);
			return backend.open(target, sink);
		},
	});
}

describe("what the core does not trust from an adapter", () => {
	test("an answer that breaks the contract never leaves; the request is answered internal", async () => {
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				listModels: async (): Promise<ModelsListResult> => ({
					status: "accepted",
					models: [{ id: "", displayName: "", thinking: { options: [] }, isDefault: false }],
				}),
			}),
		});
		const client = await rig.client("a");
		expect(await client.request("models.list", { backend: "pi" })).toMatchObject({
			type: "error",
			error: { code: "internal", message: expect.stringContaining("breaks the contract") },
		});
		expect(client.violations).toEqual([]);
	});

	test("catalog news that breaks the contract is dropped and logged", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		client.clear();
		rig.host.catalog.emit({ type: "session_removed", session: { backend: "pi", sessionId: "" } });
		expect([client.messages, client.violations]).toEqual([[], []]);
		expect(rig.log.errors.some((line) => line.includes("catalog event that breaks the contract"))).toBe(true);
	});

	test("an open whose snapshot breaks the contract fails, and the session it opened is closed", async () => {
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				open: async (target, sink) => {
					const result = await backend.open(target, sink);
					return result.status === "rejected" ? result : { ...result, snapshot: { ...result.snapshot, modelId: "" } };
				},
			}),
		});
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		expect(await client.request("session.attach", { session })).toMatchObject({
			error: { code: "internal", message: expect.stringContaining("backend_error") },
		});
		expect(rig.opens.closed).toEqual([session.sessionId]);
		expect(rig.log.errors.some((line) => line.includes("invalid snapshot"))).toBe(true);
	});

	test("records an adapter sends after its session was closed reach nobody and change nothing", async () => {
		const sinks: SessionSink[] = [];
		const rig = await startCoreRig({ adapt: keepingSinks(sinks) });
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const first = await client.ok("session.attach", { session });
		await client.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([session.sessionId]);
		expect(rig.clock.pending()).toBe(0);
		client.clear();
		sinks[0]?.emit({ at: 1, event: { type: "notice", level: "info", text: "too late" } });
		expect(client.messages).toEqual([]);
		expect(rig.clock.pending()).toBe(0);
		const again = await client.ok("session.attach", { session });
		expect(again.sync).toMatchObject({ kind: "snapshot", lastSeq: 0 });
		expect(again.sync.epoch).not.toBe(first.sync.epoch);
	});

	test("a session that goes on under a new id while it is being attached is not attached to, by an app that cannot be told of the replacement", async () => {
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				open: async (target, sink) => {
					const result = await backend.open(target, sink);
					const next = { backend: "pi" as const, sessionId: "goes-on" };
					queueMicrotask(() => sink.emit({ at: 1, event: { type: "session_replaced", session: next } }));
					return result;
				},
			}),
		});
		const client = await rig.client("a", { major: 1, minor: 0 });
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		expect(await client.request("session.attach", { session })).toMatchObject({
			error: { code: "unknown_session", message: "the session went away while attaching" },
		});
		expect(await client.request("abort", { session })).toMatchObject({ error: { code: "not_attached" } });
	});

	test("an open or a close that throws before it returns a promise is a failure like any other", async () => {
		let failOpen = true;
		const rig = await startCoreRig({
			adapt: (backend) => {
				const closing = wrappingSessions(backend, (session) =>
					changedSession(session, {
						close: () => {
							void session.close();
							throw new Error("close at once");
						},
					}),
				);
				return {
					...closing,
					open: (target, sink): Promise<OpenResult> => {
						if (failOpen) throw new Error("open at once");
						return closing.open(target, sink);
					},
				};
			},
		});
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		expect(await client.request("session.attach", { session })).toMatchObject({
			error: { code: "internal", message: expect.stringContaining("failed to open the session: Error: open at once") },
		});
		failOpen = false;
		const first = await client.ok("session.attach", { session });
		await client.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.log.errors.some((line) => line.includes("close threw: Error: close at once"))).toBe(true);
		const again = await client.ok("session.attach", { session });
		expect(again.sync.epoch).not.toBe(first.sync.epoch);
	});

	test("an answer the adapter throws on frees the interaction for the next answer", async () => {
		let broken = true;
		const rig = await startCoreRig({
			adapt: (backend) =>
				wrappingSessions(backend, (session) =>
					changedSession(session, {
						control: (control) => ({
							...control,
							answer: async (answer) => {
								if (broken) throw new Error("lost the answer");
								return control.answer(answer);
							},
						}),
					}),
				),
		});
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [{ kind: "ask", title: "Go on?", request: { kind: "confirm" } }]);
		const attached = await client.ok("session.attach", { session });
		await client.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const asked = client.events(session).find((event) => event.type === "interaction_requested");
		if (asked?.type !== "interaction_requested" || attached.sync.kind !== "snapshot") throw new Error("no ask");
		const answer = { interactionId: asked.interaction.id, reply: validReply(asked.interaction) };
		expect(await client.request("interaction.answer", { session, answer })).toMatchObject({
			error: { code: "internal" },
		});
		broken = false;
		expect((await client.ok("interaction.answer", { session, answer })).result).toEqual({ status: "accepted" });
	});

	test("an attach whose answer cannot reach the phone leaves the phone viewing nothing", async () => {
		const rig = await startCoreRig({ core: { maxFrameBytes: 64 * 1024 } });
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const condition = [{ key: "k", op: "eq" as const, value: { kind: "text" as const, value: "z".repeat(100_000) } }];
		rig.fake.fake.script(session, [
			{
				kind: "ask",
				title: "Fill in",
				request: {
					kind: "form",
					fields: [
						{ kind: "boolean", key: "k", required: false, hidden: false, when: [] },
						{ kind: "boolean", key: "s", required: false, hidden: false, when: condition },
					],
				},
			},
		]);
		await client.ok("session.attach", { session });
		await client.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const late = await rig.client("late");
		expect(await late.request("session.attach", { session })).toMatchObject({
			error: { code: "internal", message: expect.stringContaining("the link carries at most") },
		});
		expect(await late.request("abort", { session })).toMatchObject({ error: { code: "not_attached" } });
	});

	test("a call that never settles is answered internal at the deadline, and its late result is dropped", async () => {
		const gate = new Gate<ModelsListResult>();
		const rig = await startCoreRig({ adapt: (backend) => ({ ...backend, listModels: () => gate.hold() }) });
		const client = await rig.client("a");
		client.clear();
		const asking = client.request("models.list", { backend: "pi" });
		await gate.arrived();
		rig.clock.advance(REQUEST_DEADLINE_MS - 1);
		await quiesce();
		expect(client.messages).toEqual([]);
		rig.clock.advance(1);
		expect(client.messages).toMatchObject([
			{ type: "error", error: { code: "internal", message: expect.stringContaining("within") } },
		]);
		gate.pass({ status: "accepted", models: [] });
		expect((await asking).type).toBe("error");
		expect(client.messages).toHaveLength(1);
		expect(rig.log.errors.some((line) => line.includes("was answered already"))).toBe(true);
	});
});
