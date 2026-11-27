/**
 * What a failed live test leaves with agy, on the contract's fake backend standing in for agy behind the live guard:
 * a turn still going holds the account's one turn, so every other session's prompt is refused, as the tests after a
 * timed-out one were, until the guard ends the backend (`Guarded.end`, which `liveTest` runs for every open world).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentBackend, OpenSession, PromptInput } from "../../contract";
import { CatalogRecorder, SessionRecorder } from "../../contract/testing/conformance-harness";
import { createFakeBackend } from "../../contract/testing/fake-backend";
import { changedSession, wrappingSessions } from "../helpers/core-adapters";
import { tempDirectory } from "../helpers/workspace-rig";
import { Account } from "./live/account";
import { type Guarded, guardBackend } from "./live/guard";
import type { CheapChoice } from "./live/model";
import { input } from "./live/runs";

const CHOICE: CheapChoice = {
	modelId: "fake-large",
	thinking: "low",
	deepThinking: "high",
	mode: { axis: "permissions", value: "ask" },
};
const ledgers = tempDirectory("broski-live-end-");

afterAll(() => rmSync(ledgers, { recursive: true, force: true }));

function guarded(account: Account, backend: AgentBackend): Guarded {
	const opened = async () => undefined;
	return guardBackend(backend, { label: "end", account, onApiKey: () => undefined, opened, choice: CHOICE, roots: [] });
}

async function opened(guard: Guarded): Promise<{ readonly view: OpenSession; readonly recorder: SessionRecorder }> {
	const recorder = new SessionRecorder(1_000);
	const result = await guard.backend.open({ kind: "new", options: { cwd: "/fake" } }, recorder);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return { view: result.session, recorder };
}

function prompt(view: OpenSession, sent: PromptInput) {
	return view.control?.prompt(sent) ?? Promise.reject(new Error("the session has no control"));
}

/** A session of a fresh fake whose run holds until something ends it, and another session's prompt waiting to go. */
async function heldTurn(changed?: (backend: AgentBackend) => AgentBackend) {
	const account = new Account(join(ledgers, `${crypto.randomUUID()}.lock`));
	const fake = createFakeBackend({ catalog: new CatalogRecorder(1_000) });
	const left = guarded(account, changed?.(fake) ?? fake);
	const held = await opened(left);
	fake.fake.script(held.view.session, [{ kind: "hold" }]);
	expect(await prompt(held.view, input("Hold."))).toEqual({ status: "accepted", disposition: "started" });
	const next = await opened(guarded(account, createFakeBackend({ catalog: new CatalogRecorder(1_000) })));
	const waiting = input("The next test's prompt.");
	await expect(prompt(next.view, waiting)).rejects.toThrow("one at a time");
	return { left, held, next, waiting };
}

function runsFinished(recorder: SessionRecorder) {
	return recorder.items.flatMap(({ event }) => (event.type === "run_finished" ? [event.outcome] : []));
}

describe("a failed live test's turns", () => {
	test("end aborts the run still going through the guarded control, which frees the account's turn", async () => {
		const { left, held, next, waiting } = await heldTurn();
		await left.end();
		expect(runsFinished(held.recorder)).toEqual([{ kind: "aborted" }]);
		expect(await prompt(next.view, waiting)).toEqual({ status: "accepted", disposition: "started" });
	});

	test("a turn the abort does not end, as one agy never answers, is freed when end disposes its backend", async () => {
		const deaf = (backend: AgentBackend) =>
			wrappingSessions(backend, (session) =>
				changedSession(session, {
					control: (control) => ({ ...control, abort: async () => ({ status: "accepted" }) }),
				}),
			);
		const { left, held, next, waiting } = await heldTurn(deaf);
		await left.end();
		expect(runsFinished(held.recorder)).toEqual([]);
		expect(await prompt(next.view, waiting)).toEqual({ status: "accepted", disposition: "started" });
	});
});
