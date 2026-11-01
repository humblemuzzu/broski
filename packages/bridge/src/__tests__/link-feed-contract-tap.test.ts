/**
 * The contract feed's parts on their own: the time a done alert carries, and a verdict the core could not apply,
 * which leaves the alert open to the next one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	type ActionResult,
	emptySnapshot,
	type SessionRef,
	type SessionSnapshot,
	type ToolPermissionReply,
} from "../contract";
import type { ObservedEvent } from "../core/observer";
import { applyContractDecision } from "../server/link-feed/contract-decision";
import { ContractFeedTap } from "../server/link-feed/contract-tap";
import type { LinkFeedEventMessage, LinkFeedMessage } from "../server/link-feed/format";
import { LinkFeedRequests } from "../server/link-feed/requests";
import { LinkFeedTracker } from "../server/link-feed/tracker";
import { shortTiming } from "./link/feed-client";

const SESSION: SessionRef = { backend: "pi", sessionId: "s-1" };
let restoreTiming: (() => void) | undefined;

afterEach(() => {
	restoreTiming?.();
	restoreTiming = undefined;
});

function observed(event: ObservedEvent["event"], before: SessionSnapshot, after: SessionSnapshot, at: number) {
	return { session: SESSION, at, event, before, after, describe: async () => undefined };
}

describe("the done alert of a contract session", () => {
	test("carries the time the core stamped on the run's end, not the bridge's wall clock", async () => {
		restoreTiming = shortTiming();
		const delivered: LinkFeedMessage[] = [];
		const tap = new ContractFeedTap(new LinkFeedTracker((message) => delivered.push(message), new LinkFeedRequests()));
		const running = {
			...emptySnapshot(),
			run: { runId: "r", trigger: "prompt" as const, startedAt: 7, items: [], droppedItems: 0 },
		};
		tap.observe(observed({ type: "run_started", runId: "r", trigger: "prompt" }, emptySnapshot(), running, 7));
		tap.observe(
			observed({ type: "run_finished", runId: "r", outcome: { kind: "completed" } }, running, emptySnapshot(), 42),
		);
		const done = await waitFor(() =>
			delivered.find((message): message is LinkFeedEventMessage => message.type === "link_event"),
		);
		expect(done).toMatchObject({ kind: "done", at: 42 });
	});
});

const ALLOW: ToolPermissionReply = { kind: "tool_permission", optionId: "yes", grantIds: [] };

function announced(requests: LinkFeedRequests): void {
	requests.announce(
		"pi",
		"s-1",
		"i-1",
		{ kind: "approval", contract: { session: SESSION, interaction: "i-1", replies: { allow: ALLOW } } },
		{
			type: "link_event",
			kind: "approval",
			backend: "pi",
			session: "s-1",
			cwd: "project",
			title: "t",
			body: "b",
			at: 1,
			request: "i-1",
		},
	);
}

async function decide(requests: LinkFeedRequests, answer: () => Promise<ActionResult>) {
	const record = requests.find("pi", "s-1", "i-1");
	const target = record?.contract;
	if (record === undefined || target === undefined) throw new Error("the request was not announced");
	return applyContractDecision(
		{ backend: "pi", session: "s-1", request: "i-1", decision: "allow" },
		record,
		target,
		requests,
		answer,
	);
}

describe("a verdict on a contract session's approval", () => {
	test("the core could not apply for a passing reason leaves the alert open, and the next verdict answers it", async () => {
		const requests = new LinkFeedRequests();
		announced(requests);
		const failed = await decide(requests, async () => ({
			status: "rejected",
			rejection: { code: "backend_error", message: "the backend did not answer in time" },
		}));
		expect(failed).toEqual({ ok: false, error: "the backend did not answer in time" });
		expect(requests.pending()).toHaveLength(1);
		expect(await decide(requests, async () => ({ status: "accepted" }))).toEqual({ ok: true, error: null });
		expect(requests.pending()).toEqual([]);
		expect(await decide(requests, async () => ({ status: "accepted" }))).toEqual({
			ok: false,
			error: "already answered",
		});
	});

	test("that finds the ask gone closes the alert for good", async () => {
		const requests = new LinkFeedRequests();
		announced(requests);
		const gone = await decide(requests, async () => ({
			status: "rejected",
			rejection: { code: "stale", message: "x" },
		}));
		expect(gone).toEqual({ ok: false, error: "no longer pending" });
		expect(requests.pending()).toEqual([]);
	});
});

async function waitFor<T>(find: () => T | undefined): Promise<T> {
	for (let tries = 0; tries < 200; tries++) {
		const found = find();
		if (found !== undefined) return found;
		await Bun.sleep(5);
	}
	throw new Error("nothing arrived");
}
