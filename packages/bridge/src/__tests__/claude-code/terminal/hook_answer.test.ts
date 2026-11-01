/** Contract rule 31 (answering without control) against the watch-only open of a terminal session (Step 3b). */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TerminalAskHandler, TerminalPermissionDecision } from "../../../backends/claude-code/ports/terminal";
import { CLAUDE_CODE_TRAITS } from "../../../backends/claude-code/traits";
import {
	type Interaction,
	type InteractionReply,
	type OpenSession,
	type SessionSnapshot,
	sessionAnswerer,
	sessionCapabilities,
} from "../../../contract";
import { invalidReplies, validReply } from "../../../contract/testing/example-replies";
import { streamViolations } from "../../../contract/testing/stream-rules";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { type TerminalRig, terminalRig } from "./rig";
import { type WatchedAskHelper, watchedAskHelper } from "./watched-ask";

let home: ClaudeHome;
let handler: TerminalAskHandler | undefined;
let rig: TerminalRig;
let helper: WatchedAskHelper;

beforeEach(async () => {
	home = createClaudeHome({ git: false });
	handler = undefined;
	rig = terminalRig(home, { terminal: { hookAsks: (next) => (handler = next) } });
	await rig.watch.start();
	helper = watchedAskHelper({ configDir: home.configDir, projectDir: home.projectDir, handler: () => handler });
});

afterEach(async () => {
	await helper.dispose();
	await rig.watch.dispose();
	home.cleanup();
});

async function openWatched(): Promise<{ session: OpenSession; initial: SessionSnapshot; ask: Interaction }> {
	const ref = await helper.watchedAsk();
	if (ref === undefined) throw new Error("the adapter gave no handler");
	expect(await rig.watch.writing(ref.sessionId)).toBe(true);
	const opened = await rig.open(ref.sessionId);
	if (opened.status !== "accepted") throw new Error("open refused");
	await rig.waitFor((records) => records.some((r) => r.event.type === "interaction_requested"), 5_000);
	const ask = opened.session.snapshot().interactions[0];
	if (ask === undefined) throw new Error("no ask pending");
	return { session: opened.session, initial: opened.snapshot, ask };
}

describe("a terminal session whose ask can be answered here", () => {
	test("is watch-only with an answer member, and its capabilities say so", async () => {
		const { session } = await openWatched();
		expect(session.control).toBeUndefined();
		expect(session.answer).toBeDefined();
		expect(sessionAnswerer(session)).toBeDefined();
		expect(sessionCapabilities(session)).toMatchObject({ controllable: false, answer: true });
	});

	test("checks every answer, resolves the ask once, then says stale, and says closed after close", async () => {
		const { session, initial, ask } = await openWatched();
		const answer = session.answer;
		if (answer === undefined) throw new Error("no answer member");
		for (const reply of invalidReplies(ask)) {
			const result = await answer({ interactionId: ask.id, reply });
			expect(result.status === "rejected" && result.rejection.code).toBe("invalid_input");
		}
		expect(session.snapshot().interactions.map((i) => i.id)).toEqual([ask.id]);
		const valid = validReply(ask);
		expect((await answer({ interactionId: ask.id, reply: valid })).status).toBe("accepted");
		const resolved = rig.records.find((r) => r.event.type === "interaction_resolved");
		expect(resolved?.event).toMatchObject({ interactionId: ask.id, reason: "answered" });
		const repeat = await answer({ interactionId: ask.id, reply: valid });
		expect(repeat.status === "rejected" && repeat.rejection.code).toBe("stale");
		await session.close();
		const late = await answer({ interactionId: ask.id, reply: valid });
		expect(late.status === "rejected" && late.rejection.code).toBe("closed");
		expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, initial)).toEqual([]);
	});

	test("a reply the ask does not allow is refused before it reaches the hook: a message on a plain allow, an edited input", async () => {
		const { session, ask } = await openWatched();
		for (const reply of [
			{ kind: "tool_permission", optionId: "allow-once", grantIds: [], message: "hi" },
			{ kind: "tool_permission", optionId: "allow-once", grantIds: [], editedInput: { command: "rm -rf /" } },
		] satisfies InteractionReply[]) {
			const result = await session.answer?.({ interactionId: ask.id, reply });
			expect(result?.status === "rejected" && result.rejection.code).toBe("invalid_input");
		}
		expect(session.snapshot().interactions).toHaveLength(1);
	});

	test("an answer that stops the run reaches the hook as an interrupt; the plain options do not", async () => {
		const { session, ask } = await openWatched();
		if (ask.request.kind !== "tool_permission") throw new Error("not a permission ask");
		const options = ask.request.options;
		expect(options.filter((o) => o.stopsRun).map((o) => o.id)).toEqual(["deny-and-stop"]);
		expect(options.filter((o) => !o.stopsRun).map((o) => `${o.id}:${o.effect}:${o.scope}`)).toEqual([
			"allow-once:allow:once",
			"deny-once:deny:once",
		]);
		expect((await session.answer?.({ interactionId: ask.id, reply: { kind: "cancel", stopRun: true } }))?.status).toBe(
			"accepted",
		);
	});

	test("the hook is answered with the decision the reply stands for", async () => {
		const cases: [InteractionReply, TerminalPermissionDecision | undefined][] = [
			[{ kind: "tool_permission", optionId: "allow-once", grantIds: [] }, { behavior: "allow" }],
			[
				{ kind: "tool_permission", optionId: "deny-and-stop", grantIds: [], message: "no" },
				{ behavior: "deny", message: "no", interrupt: true },
			],
			[
				{ kind: "cancel", stopRun: true },
				{ behavior: "deny", message: "Denied from the Broski app.", interrupt: true },
			],
			[{ kind: "cancel", stopRun: false }, undefined],
		];
		for (const [reply, decision] of cases) {
			rig.records.length = 0;
			const { session, ask } = await openWatched();
			await session.answer?.({ interactionId: ask.id, reply });
			const ref = session.session;
			expect(await helper.decision(ref)).toEqual(decision);
			await session.close();
		}
	});
});

describe("a terminal session whose asks cannot be answered here", () => {
	test("offers no answer member when the server gave no hook handler, and says so in its capabilities", async () => {
		const bare = terminalRig(home);
		await bare.watch.start();
		const made = await watchedAskHelper({
			configDir: home.configDir,
			projectDir: home.projectDir,
			handler: () => async () => undefined,
		}).watchedAsk();
		const opened = made === undefined ? undefined : await bare.open(made.sessionId);
		if (opened?.status !== "accepted") throw new Error("open refused");
		expect(opened.session.control).toBeUndefined();
		expect(opened.session.answer).toBeUndefined();
		expect(sessionCapabilities(opened.session)).toMatchObject({ controllable: false, answer: false });
		await bare.watch.dispose();
	});
});
