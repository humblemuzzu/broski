/**
 * What the daemon's feed says about a session served through the backend contract, driven through the
 * real core, the real link socket and the real feed: busy and done, approvals and questions, and a
 * verdict answered as a person's answer.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { InteractionAnswer, InteractionId, InteractionRequest, SessionRef } from "../contract";
import { sampleRequest } from "../contract/testing/fake-scenarios";
import type { FakeStep } from "../contract/testing/fake-script";
import { resetLinkFeed } from "../server/link-feed/feed";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { recordingAnswers } from "./helpers/core-adapters";
import { type CoreBridge, removeRoot, startCoreBridge } from "./helpers/core-bridge";
import { promptInput } from "./helpers/core-rig";
import type { LinkContractClient } from "./helpers/link-contract-client";
import { alertsOf, busyFrame, DAEMON_HEADERS, finishFeed, openFeed, shortTiming } from "./link/feed-client";
import { connectUnixWs, type LinkFrame, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const TOOL: FakeStep[] = [
	{ kind: "tool", name: "bash", input: { command: "rm -rf build" }, output: "removed", permission: true },
	{ kind: "text", text: "Cleaned the build.\nIt is gone." },
];

type Scene = {
	rig: CoreBridge;
	phone: LinkContractClient;
	feed: UnixWsClient;
	session: SessionRef;
	answers: InteractionAnswer[];
};

let restoreTiming: () => void;
let scene: Scene | undefined;

beforeEach(() => {
	resetLinkFeed();
	restoreTiming = shortTiming();
});

afterEach(async () => {
	const current = scene;
	scene = undefined;
	if (current) {
		await current.rig.stop();
		removeRoot(current.rig.root);
	}
	await finishFeed(current?.feed ?? null, restoreTiming);
});

/** `watched`: the session belongs to another client, can only be watched, and takes answers to its asks. */
async function startScene(steps: FakeStep[], watched = false): Promise<Scene> {
	const answers: InteractionAnswer[] = [];
	const rig = await startCoreBridge({ adapt: (backend) => recordingAnswers(backend, answers) });
	const phone = await rig.phone("phone");
	const session = rig.fake.fake.seed({ cwd: rig.cwd, title: "Fix the build", external: watched, answerable: watched });
	if (!watched) rig.fake.fake.script(session, steps);
	await phone.ok("session.attach", { session });
	const feed = await openFeed(rig.socketPath);
	scene = { rig, phone, feed, session, answers };
	return scene;
}

async function prompt(current: Scene): Promise<void> {
	await current.phone.ok("prompt", { session: current.session, input: promptInput("Go") });
}

async function decide(
	current: Scene,
	request: string,
	decision: "allow" | "deny",
	session: string = current.session.sessionId,
	backend = "pi",
): Promise<LinkFrame> {
	current.feed.clear();
	current.feed.send({ type: "link_decision", backend, session, request, decision });
	return current.feed.waitForWhere(
		(frame) => frame.type === "link_decision_result" && frame.request === request,
		"link_decision_result",
	);
}

/** A feed as the daemon redials one, with nothing dropped: the replay arrives in the same burst as `link_busy`. */
async function attachFeed(socketPath: string): Promise<UnixWsClient> {
	const feed = await connectUnixWs(socketPath, DAEMON_HEADERS);
	await feed.waitFor("link_busy");
	return feed;
}

function permissionRequest(overrides: { deliberate: boolean }): InteractionRequest {
	return {
		kind: "tool_permission",
		inputEditable: false,
		previews: [],
		options: [
			{ id: "yes", label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" },
			{ id: "no", label: "Deny", effect: "deny", scope: "once", stopsRun: false, message: "none" },
		],
		grants: [],
		...overrides,
	};
}

function interactionOf(alert: LinkFrame): InteractionId {
	if (typeof alert.request !== "string") throw new Error("the alert carries no request id");
	return alert.request;
}

async function waitForResolution(current: Scene): Promise<void> {
	await current.phone.waitForEvent(
		current.session,
		(envelope) => envelope.event.type === "interaction_resolved",
		"the interaction's resolution",
	);
}

describe("busy and done for a contract session", () => {
	test("a run is work, and its end is one done alert with the first line of the answer", async () => {
		const current = await startScene([{ kind: "text", text: "All set.\nSecond line stays home." }]);
		await prompt(current);
		await busyFrame(current.feed, true);
		await busyFrame(current.feed, false);
		const [done] = await alertsOf(current.feed, 1);
		expect(done).toMatchObject({
			type: "link_event",
			kind: "done",
			backend: "pi",
			session: current.session.sessionId,
			cwd: "project",
			title: "Fix the build — finished",
			body: "All set.",
		});
		expect(done?.request).toBeUndefined();
		await Bun.sleep(300);
		expect(current.feed.frames().filter((frame) => frame.type === "link_event")).toHaveLength(1);
	});

	test("a long answer line is cut to the body's bound", async () => {
		const long = "x".repeat(500);
		const current = await startScene([{ kind: "text", text: long }]);
		await prompt(current);
		const [done] = await alertsOf(current.feed, 1);
		expect(String(done?.body)).toHaveLength(200);
		expect(String(done?.body).endsWith("…")).toBe(true);
	});

	test("a failed run says so by its code and quotes no message", async () => {
		const current = await startScene([
			{ kind: "fail", error: { code: "rate_limit", message: "key sk-secret-123 hit the limit" } },
		]);
		await prompt(current);
		const [done] = await alertsOf(current.feed, 1);
		expect(done).toMatchObject({
			kind: "done",
			title: "Fix the build — stopped with an error",
			body: "Run failed: rate_limit",
		});
		expect(JSON.stringify(done)).not.toContain("sk-secret");
	});

	test("a run the person stopped is no news", async () => {
		const current = await startScene([{ kind: "text", text: "Working." }, { kind: "hold" }]);
		await prompt(current);
		await busyFrame(current.feed, true);
		await current.phone.ok("abort", { session: current.session });
		await busyFrame(current.feed, false);
		await Bun.sleep(400);
		expect(current.feed.frames().filter((frame) => frame.type === "link_event")).toEqual([]);
	});

	test("a session no phone opened produces no alert and no busy", async () => {
		const current = await startScene([{ kind: "text", text: "Quiet." }]);
		const unopened = current.rig.fake.fake.seed({ cwd: current.rig.cwd, title: "Never opened" });
		current.rig.fake.fake.script(unopened, TOOL);
		await Bun.sleep(300);
		expect(current.feed.frames()).toEqual([]);
	});
});

describe("approvals", () => {
	test("a pending tool permission is an approval alert, and an allow answers allow-once exactly once", async () => {
		const current = await startScene(TOOL);
		await prompt(current);
		const [approval] = await alertsOf(current.feed, 1);
		expect(approval).toMatchObject({
			kind: "approval",
			backend: "pi",
			session: current.session.sessionId,
			cwd: "project",
			title: "Fix the build — needs approval",
			body: "bash: bash",
		});
		const request = interactionOf(approval as LinkFrame);

		expect(await decide(current, request, "allow")).toMatchObject({ ok: true, error: null });
		await waitForResolution(current);
		expect(current.answers).toEqual([
			{ interactionId: request, reply: { kind: "tool_permission", optionId: "allow_once", grantIds: [] } },
		]);

		expect(await decide(current, request, "allow")).toMatchObject({ ok: false, error: "already answered" });
		expect(await decide(current, request, "deny")).toMatchObject({ ok: false, error: "already answered" });
		expect(current.answers).toHaveLength(1);

		const [done] = await alertsOf(current.feed, 1);
		expect(done).toMatchObject({ kind: "done", body: "Cleaned the build." });
	});

	test("an approval another client's run raised in a watched session is answered from the lock screen", async () => {
		const current = await startScene(TOOL, true);
		current.rig.fake.fake.runExternally(current.session, "From the terminal.", TOOL);
		const request = interactionOf((await alertsOf(current.feed, 1))[0] as LinkFrame);
		expect(await decide(current, request, "allow")).toMatchObject({ ok: true, error: null });
		await waitForResolution(current);
		expect(current.answers).toEqual([
			{ interactionId: request, reply: { kind: "tool_permission", optionId: "allow_once", grantIds: [] } },
		]);
	});

	test("a deny answers the plain deny, not the one that stops the run", async () => {
		const current = await startScene(TOOL);
		await prompt(current);
		const request = interactionOf((await alertsOf(current.feed, 1))[0] as LinkFrame);
		expect(await decide(current, request, "deny")).toMatchObject({ ok: true, error: null });
		await waitForResolution(current);
		expect(current.answers).toEqual([
			{ interactionId: request, reply: { kind: "tool_permission", optionId: "deny", grantIds: [] } },
		]);
	});

	test("an approval the backend took back first is no longer pending, and nothing is answered", async () => {
		const current = await startScene(TOOL);
		await prompt(current);
		const request = interactionOf((await alertsOf(current.feed, 1))[0] as LinkFrame);
		current.rig.fake.fake.answerElsewhere(current.session, request);
		await waitForResolution(current);
		expect(await decide(current, request, "allow")).toMatchObject({ ok: false, error: "no longer pending" });
		expect(current.answers).toEqual([]);
	});

	test("an approval the phone answered itself is closed to the feed too", async () => {
		const current = await startScene(TOOL);
		await prompt(current);
		const request = interactionOf((await alertsOf(current.feed, 1))[0] as LinkFrame);
		const answer: InteractionAnswer = {
			interactionId: request,
			reply: { kind: "tool_permission", optionId: "deny", grantIds: [] },
		};
		await current.phone.ok("interaction.answer", { session: current.session, answer });
		await waitForResolution(current);
		expect(await decide(current, request, "allow")).toMatchObject({ ok: false, error: "no longer pending" });
		expect(current.answers).toEqual([answer]);
	});

	test("a request the feed never announced, in another session or backend, answers nothing", async () => {
		const current = await startScene(TOOL);
		await prompt(current);
		const request = interactionOf((await alertsOf(current.feed, 1))[0] as LinkFrame);
		expect(await decide(current, request, "allow", "some-other-session")).toMatchObject({
			ok: false,
			error: "unknown request",
		});
		expect(await decide(current, "never-asked", "allow")).toMatchObject({ ok: false, error: "unknown request" });
		expect(await decide(current, request, "allow", current.session.sessionId, "claude-code")).toMatchObject({
			ok: false,
			error: "unknown request",
		});
		expect(await decide(current, request, "allow", current.session.sessionId, "nonsense")).toMatchObject({
			ok: false,
			error: "unknown backend",
		});
		expect(current.answers).toEqual([]);
	});

	test("a device socket's link_decision is no contract frame: it is refused and answers nothing", async () => {
		const current = await startScene(TOOL);
		await prompt(current);
		const request = interactionOf((await alertsOf(current.feed, 1))[0] as LinkFrame);
		const decision = { type: "link_decision", backend: "pi", session: current.session.sessionId, request };
		current.phone.socket.send({ ...decision, decision: "allow" });
		const refused = await current.phone.waitForMessage(
			(message) => message.type === "error" && message.error.code === "invalid_message",
			"the refusal",
		);
		expect(refused.type).toBe("error");
		expect(current.phone.socket.frames().some((frame) => frame.type === "link_decision_result")).toBe(false);
		expect(current.answers).toEqual([]);
		expect(await decide(current, request, "deny")).toMatchObject({ ok: true, error: null });
	});

	test("a feed that redials is told the approval again, until it is answered or taken back", async () => {
		const current = await startScene(TOOL);
		await prompt(current);
		const [announced] = await alertsOf(current.feed, 1);
		const request = interactionOf(announced as LinkFrame);

		const redialed = await attachFeed(current.rig.socketPath);
		try {
			const again = await redialed.waitForWhere((frame) => frame.type === "link_event", "the replayed approval");
			expect(again).toEqual(announced as LinkFrame);
		} finally {
			redialed.close();
		}

		current.rig.fake.fake.answerElsewhere(current.session, request);
		await waitForResolution(current);
		const later = await attachFeed(current.rig.socketPath);
		try {
			await Bun.sleep(100);
			expect(later.frames().filter((frame) => frame.type === "link_event" && frame.kind === "approval")).toEqual([]);
		} finally {
			later.close();
		}
	});
});

describe("questions", () => {
	const KINDS = ["confirm", "choice", "text", "form", "questions", "plan_approval", "external_url"] as const;

	test("each interaction that needs an answer is an attention alert a verdict cannot answer", async () => {
		for (const kind of KINDS) {
			resetLinkFeed();
			const current = await startScene([
				{ kind: "ask", title: `A ${kind} question`, request: sampleRequest(kind) },
				{ kind: "text", text: "Thanks." },
			]);
			await prompt(current);
			const [alert] = await alertsOf(current.feed, 1);
			expect([kind, alert]).toEqual([
				kind,
				expect.objectContaining({
					kind: "attention",
					backend: "pi",
					title: "Fix the build — needs input",
					body: `A ${kind} question`,
				}),
			]);
			const request = interactionOf(alert as LinkFrame);
			expect([kind, (await decide(current, request, "allow")).error]).toEqual([kind, "unsupported"]);
			expect([kind, (await decide(current, request, "deny")).error]).toEqual([kind, "unsupported"]);
			expect(current.answers).toEqual([]);
			await current.rig.stop();
			removeRoot(current.rig.root);
			current.feed.close();
			scene = undefined;
		}
	});
});

describe("a permission that asks for a closer look", () => {
	test("a deliberate request can be denied from a lock screen but not allowed", async () => {
		const permission = permissionRequest({ deliberate: true });
		const current = await startScene([
			{ kind: "ask", title: "Allow rm?", request: permission },
			{ kind: "text", text: "Done." },
		]);
		await prompt(current);
		const request = interactionOf((await alertsOf(current.feed, 1))[0] as LinkFrame);
		expect(await decide(current, request, "allow")).toMatchObject({ ok: false, error: "unsupported" });
		expect(current.answers).toEqual([]);
		expect(await decide(current, request, "deny")).toMatchObject({ ok: true });
		expect(current.answers).toHaveLength(1);
	});
});
