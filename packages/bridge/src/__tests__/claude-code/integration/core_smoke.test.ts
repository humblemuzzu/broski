/**
 * The whole path a phone takes, end to end: the bridge core speaking the contract to a client, the Claude Code adapter
 * under it, and the real CLI against the scripted endpoint in a temp home. One session goes from create to delete
 * through every kind of ask a hosted session raises; a terminal's permission prompt then reaches the same client
 * through the installed hook, held open by the core, and is answered once.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
	AgentEvent,
	Interaction,
	InteractionReply,
	PromptInput,
	SessionRef,
	ToolFinishedEvent,
} from "../../../contract";
import { streamViolations, unsettledParts } from "../../../contract/testing/stream-rules";
import { BridgeCore } from "../../../core/core";
import { ManualClock, RecordingLog, TestClient } from "../../helpers/core-rig";
import { INPUT_TOKENS } from "../../helpers/scripted-anthropic-sse";
import { ClaudeCodeConformanceDriver } from "../conformance/driver";
import { ClaudeWorld } from "../conformance/world";
import { expectNoOrphans } from "../spike/rig/orphans";

const WAIT_MS = 30_000;
const STEP_MS = 120_000;

let core: BridgeCore;
let world: ClaudeWorld;
let driver: ClaudeCodeConformanceDriver;
let phone: TestClient;

beforeAll(async () => {
	core = new BridgeCore({
		bridgeVersion: "0.0.0-smoke",
		maxFrameBytes: 8 * 1024 * 1024,
		log: new RecordingLog(),
		clock: new ManualClock(),
		directories: async (path) => ({ path }),
	});
	const seam = { hold: (ref: SessionRef) => core.hold(ref), release: (ref: SessionRef) => core.release(ref) };
	const added = await core.addBackend("claude-code", async (host) => {
		world = await ClaudeWorld.create(host, seam);
		return world.backend;
	});
	if (!added) throw new Error("the Claude Code backend did not start");
	driver = new ClaudeCodeConformanceDriver(world, WAIT_MS);
	phone = new TestClient(core, "phone");
	await phone.hello();
});

afterAll(async () => {
	await core.dispose();
	const escapes = world.escapes();
	await world.dispose();
	expect(escapes).toEqual([]);
	expect(phone.violations).toEqual([]);
});

expectNoOrphans();

/** The newest request that reached the model in `session`, as the CLI sent it. */
function lastSent(session: SessionRef): string {
	return JSON.stringify(world.router.requests(session.sessionId).at(-1)?.body ?? null);
}

async function until<T>(find: () => T | undefined, what: string): Promise<T> {
	const deadline = Date.now() + WAIT_MS;
	for (;;) {
		const found = find();
		if (found !== undefined) return found;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(25);
	}
}

function input(text: string): PromptInput {
	return { clientRequestId: crypto.randomUUID(), mode: "start", text, attachments: [] };
}

/** Sends a prompt and resolves with the events of the run it started, once it finished. */
async function run(session: SessionRef, text: string, answer?: (asked: Interaction) => InteractionReply) {
	const mark = phone.events(session).length;
	const sent = await phone.ok("prompt", { session, input: input(text) });
	expect(sent.result).toMatchObject({ status: "accepted", disposition: "started" });
	if (answer) {
		const asked = await until(
			() => after(session, mark).find((event) => event.type === "interaction_requested")?.interaction,
			"an ask",
		);
		const answered = await phone.ok("interaction.answer", {
			session,
			answer: { interactionId: asked.id, reply: answer(asked) },
		});
		expect(answered.result).toEqual({ status: "accepted" });
	}
	await until(() => after(session, mark).find((event) => event.type === "run_finished"), "the run's end");
	return after(session, mark);
}

function after(session: SessionRef, mark: number): AgentEvent[] {
	return phone.events(session).slice(mark);
}

function optionOf(asked: Interaction, effect: "allow" | "deny"): string {
	if (asked.request.kind !== "tool_permission") throw new Error(`a ${asked.request.kind} ask, not a permission`);
	const option = asked.request.options.find(
		(candidate) => candidate.effect === effect && candidate.scope === "once" && !candidate.stopsRun,
	);
	if (!option) throw new Error(`no ${effect}-once option`);
	return option.id;
}

const toolOutcomes = (events: readonly AgentEvent[]) =>
	events.filter((event): event is ToolFinishedEvent => event.type === "tool_finished").map((event) => event.outcome);

describe("a phone through the core to the real Claude Code", () => {
	test(
		"create, stream, every ask, then list, read, fork, rename and delete",
		async () => {
			const created = await phone.ok("session.create", {
				backend: "claude-code",
				options: { cwd: world.home.projectDir },
			});
			if (created.result.status !== "accepted") throw new Error(created.result.rejection.message);
			const session = created.result.session;
			const attached = await phone.ok("session.attach", { session });
			if (attached.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
			const initial = attached.sync.snapshot;
			expect(attached.capabilities).toMatchObject({ controllable: true, answer: true });

			await driver.arrange(session, { kind: "reply" });
			const streamed = await run(session, "Say hello.");
			expect(streamed.some((event) => event.type === "block_delta")).toBe(true);
			expect(streamed.find((event) => event.type === "run_finished")).toMatchObject({
				outcome: { kind: "completed" },
			});
			const usage = await until(
				() =>
					phone
						.events(session)
						.flatMap((event) => (event.type === "usage_updated" ? [event.usage] : []))
						.find((reported) => reported.contextTokens !== undefined),
				"the context figure after the run",
			);
			expect(usage.inputTokens ?? 0).toBeGreaterThanOrEqual(INPUT_TOKENS);
			expect(usage.outputTokens ?? 0).toBeGreaterThan(0);
			expect(usage.contextTokens ?? 0).toBeGreaterThan(0);
			expect(usage.contextWindow ?? 0).toBeGreaterThan(usage.contextTokens ?? 0);

			await driver.arrange(session, { kind: "interaction", interaction: "tool_permission" });
			const allowed = await run(session, "Write the file.", (asked) => ({
				kind: "tool_permission",
				optionId: optionOf(asked, "allow"),
				grantIds: [],
			}));
			expect(toolOutcomes(allowed)).toEqual(["completed"]);

			await driver.arrange(session, { kind: "interaction", interaction: "tool_permission" });
			const denied = await run(session, "Write it again.", (asked) => ({
				kind: "tool_permission",
				optionId: optionOf(asked, "deny"),
				message: "Not now.",
				grantIds: [],
			}));
			expect(toolOutcomes(denied)).toEqual(["denied"]);

			await driver.arrange(session, { kind: "interaction", interaction: "plan_approval" });
			const planned = await run(session, "Plan it.", (asked) => {
				if (asked.request.kind !== "plan_approval") throw new Error(`a ${asked.request.kind} ask, not a plan`);
				expect(asked.request.plan).toContain("Do it.");
				expect(asked.request.modeOptions?.options.map((option) => option.value)).toContain("acceptEdits");
				return { kind: "plan_approval", decision: "approve", modeAfter: "acceptEdits" };
			});
			expect(planned.filter((event) => event.type === "mode_changed").at(-1)).toMatchObject({
				axis: "permissions",
				value: "acceptEdits",
			});

			await driver.arrange(session, { kind: "interaction", interaction: "questions" });
			await run(session, "Ask me.", (asked) => {
				if (asked.request.kind !== "questions") throw new Error(`a ${asked.request.kind} ask, not questions`);
				const [question] = asked.request.questions;
				if (!question) throw new Error("no question");
				return { kind: "questions", answers: [{ questionId: question.id, selected: ["Blue"] }] };
			});
			expect(lastSent(session)).toContain("Blue");

			await driver.arrange(session, { kind: "interaction", interaction: "form" });
			await run(session, "Fill the form.", (asked) => {
				if (asked.request.kind !== "form") throw new Error(`a ${asked.request.kind} ask, not a form`);
				expect(asked.request.fields.map((field) => field.key)).toEqual(["name"]);
				return { kind: "form", values: { name: { kind: "text", value: "Smoke" } } };
			});
			expect(lastSent(session)).toContain("Smoke");

			const records = phone.envelopes(session).map(({ at, event }) => ({ at, event }));
			expect(streamViolations(records, world.backend.traits, initial)).toEqual([]);
			expect(unsettledParts(records, initial)).toEqual([]);

			const listed = await phone.ok("sessions.list", {
				backend: "claude-code",
				query: { cwd: world.home.projectDir },
				page: { limit: 50 },
			});
			if (listed.result.status !== "accepted") throw new Error(listed.result.rejection.message);
			expect(listed.result.page.items.map((row) => row.session.sessionId)).toContain(session.sessionId);

			const read = await phone.ok("transcript.read", { session, page: { limit: 200 } });
			if (read.result.status !== "accepted") throw new Error(read.result.rejection.message);
			const kinds = new Set(read.result.page.items.map((item) => item.kind));
			expect([...kinds]).toEqual(expect.arrayContaining(["user_message", "block", "tool_call", "tool_result"]));

			const forked = await phone.ok("session.fork", { session });
			if (forked.result.status !== "accepted") throw new Error(forked.result.rejection.message);
			const fork = forked.result.session;
			expect(fork.sessionId).not.toBe(session.sessionId);

			const renamed = await phone.ok("session.rename", { session: fork, title: "Smoke fork" });
			expect(renamed.result).toEqual({ status: "accepted" });
			const row = await phone.ok("session.get", { session: fork });
			expect(row.result).toMatchObject({
				status: "accepted",
				summary: { title: { text: "Smoke fork", source: "user" } },
			});

			const deleted = await phone.ok("session.delete", { session: fork });
			expect(deleted.result).toEqual({ status: "accepted" });
			await until(
				() =>
					phone
						.catalog()
						.find(
							(message) =>
								message.event.type === "session_removed" && message.event.session.sessionId === fork.sessionId,
						),
				"the fork's removal",
			);
			const gone = await phone.ok("session.get", { session: fork });
			expect(gone.result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
			await phone.ok("session.detach", { session });
		},
		STEP_MS,
	);

	test(
		"a terminal's permission prompt reaches the phone through the hook, held open by the core, and is answered once",
		async () => {
			const terminal = await driver.watchedAsk();
			if (terminal === undefined) throw new Error("the world raises terminal asks");
			const attached = await phone.ok("session.attach", { session: terminal });
			expect(attached.capabilities).toMatchObject({ controllable: false, answer: true });
			if (attached.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
			const asked = await until(
				() =>
					attached.sync.kind === "snapshot"
						? (attached.sync.snapshot.interactions[0] ??
							phone.events(terminal).find((event) => event.type === "interaction_requested")?.interaction)
						: undefined,
				"the terminal's ask",
			);
			const reply: InteractionReply = { kind: "tool_permission", optionId: optionOf(asked, "allow"), grantIds: [] };
			const answer = { interactionId: asked.id, reply };
			expect((await phone.ok("interaction.answer", { session: terminal, answer })).result).toEqual({
				status: "accepted",
			});
			const again = await phone.ok("interaction.answer", { session: terminal, answer });
			expect(again.result).toMatchObject({ status: "rejected", rejection: { code: "stale" } });
			await until(() => world.terminalAsks.decisions.get(terminal.sessionId)?.[0], "the hook's decision");
			expect(world.terminalAsks.decisions.get(terminal.sessionId)).toEqual([{ behavior: "allow" }]);
			const prompted = await phone.ok("prompt", { session: terminal, input: input("Take over.") });
			expect(prompted.result).toMatchObject({ status: "rejected", rejection: { code: "unsupported" } });
		},
		STEP_MS,
	);
});
