import type { AgentBackend } from "../backend";
import { BackendCall, rewritesHistory } from "../backend-ops";
import type { SessionRef } from "../ids";
import { type SessionQuery, SessionSummary } from "../sessions";
import { TranscriptItem } from "../transcript";
import { canonical, expect, fail, type Rig } from "./conformance-harness";
import { allPages, allTranscript, listed } from "./conformance-reads";

export async function sessionPagesConcatenate(rig: Rig): Promise<void> {
	const { backend, driver } = rig;
	await driver.seedSessions(driver.cwd, 5);
	await driver.seedSessions(driver.otherCwd, 2);
	const query: SessionQuery = { cwd: driver.cwd, archived: false };
	const paged = await allPages(backend, query, 2);
	const ids = paged.map((row) => row.session.sessionId);
	expect(paged.length >= 5, `expected at least 5 sessions, listed ${paged.length}`);
	expect(new Set(ids).size === ids.length, "a session appears on two pages");
	const times = paged.map((row) => row.updatedAt);
	expect(canonical(times) === canonical([...times].sort((a, b) => b - a)), "sessions are not newest first");
	expect(
		paged.every((row) => SessionSummary.safeParse(row).success && row.session.backend === backend.id),
		"a listed row is not a valid summary of this backend",
	);
	expect(
		paged.every((row) => row.cwd === driver.cwd),
		"a row outside the requested cwd was listed",
	);
	const elsewhere = await allPages(backend, { cwd: driver.otherCwd, archived: false }, 200);
	expect(elsewhere.length >= 2, "the sessions of another directory are not listed under it");
	const whole = await backend.listSessions(query, { limit: 200 });
	if (whole.status === "rejected") fail("listing in one page was rejected");
	expect(
		canonical(whole.page.items.map((row) => row.session.sessionId)) === canonical(ids),
		"pages differ from one listing",
	);
	const bad = await backend.listSessions(query, { cursor: "not-a-cursor", limit: 2 });
	expect(
		bad.status === "rejected" && bad.rejection.code === "invalid_input",
		"a cursor the adapter did not mint must be rejected invalid_input",
	);
}

export async function aSessionCanBeRead(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "reply" });
	await live.run("Say something.");
	const found = await rig.backend.getSession(live.ref);
	if (found.status === "rejected") fail(`getSession was rejected: ${found.rejection.message}`);
	const summary = found.summary;
	expect(SessionSummary.safeParse(summary).success, "getSession returned an invalid summary");
	expect(canonical(summary.session) === canonical(live.ref), "getSession returned another session");
	expect(summary.cwd === rig.driver.cwd, "the session is not in the directory it was created in");
	expect(summary.origin === "broski" && summary.status === "idle", "a finished session this bridge made is not idle");
	expect(await listed(rig.backend, { cwd: rig.driver.cwd, archived: false }, live.ref), "the session is not listed");
	const missing = await rig.backend.getSession({ ...live.ref, sessionId: crypto.randomUUID() });
	expect(
		missing.status === "rejected" && missing.rejection.code === "not_found",
		"an unknown session must be not_found",
	);
}

/** In the `tool` scenario the run is the prompt, a tool call, then a text answer, so newest first reverses that. */
export async function transcriptPagesConcatenate(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "tool" });
	const { clientRequestId } = await live.run("Use a tool, then answer.");
	const items = await allTranscript(rig.backend, live.ref, 1);
	const ids = items.map((item) => item.id);
	expect(new Set(ids).size === ids.length, "a transcript item appears on two pages");
	expect(
		items.every((item) => TranscriptItem.safeParse(item).success),
		"a transcript item is not valid",
	);
	const whole = await rig.backend.readTranscript(live.ref, { limit: 200 });
	if (whole.status === "rejected") fail("reading the transcript in one page was rejected");
	expect(canonical(whole.page.items.map((item) => item.id)) === canonical(ids), "pages differ from one read");
	const prompt = items.findIndex((item) => item.kind === "user_message" && item.clientRequestId === clientRequestId);
	const call = items.findIndex((item) => item.kind === "tool_call");
	const answer = items.findIndex((item) => item.kind === "block" && item.block === "text");
	expect(prompt >= 0, "the prompt is not in the transcript with its clientRequestId");
	expect(call >= 0, "the tool call is not in the transcript");
	expect(answer >= 0, "the answer is not in the transcript");
	expect(answer < call && call < prompt, "the transcript is not newest first");
	const bad = await rig.backend.readTranscript(live.ref, { cursor: "not-a-cursor", limit: 1 });
	expect(
		bad.status === "rejected" && bad.rejection.code === "invalid_input",
		"a transcript cursor the adapter did not mint must be rejected invalid_input",
	);
}

export async function sessionMutationsShowInTheCatalog(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "reply" });
	await live.run("Say something.");
	const { backend } = rig;
	if (has(backend, "rename")) await renames(rig, backend, live.ref);
	if (has(backend, "archive")) await archives(rig, backend, live.ref);
	if (has(backend, "fork")) await forks(backend, live.ref);
	if (has(backend, "delete")) await deletes(rig, backend, live.ref);
}

type Mutation = "rename" | "archive" | "fork" | "delete";
type With<K extends Mutation> = AgentBackend & Required<Pick<AgentBackend, K>>;

function has<K extends Mutation>(backend: AgentBackend, method: K): backend is With<K> {
	return backend[method] !== undefined;
}

async function renames(rig: Rig, backend: With<"rename">, ref: SessionRef): Promise<void> {
	const title = "Renamed by the suite";
	expect((await backend.rename(ref, title)).status === "accepted", "rename was rejected");
	await rig.catalog.waitFor(
		(events) =>
			events.find(
				(event) =>
					event.type === "session_updated" &&
					event.summary.session.sessionId === ref.sessionId &&
					event.summary.title?.text === title &&
					event.summary.title.source === "user",
			),
		"session_updated with the new title",
	);
	const found = await backend.getSession(ref);
	expect(
		found.status === "accepted" && found.summary.title?.text === title,
		"the session does not carry its new title",
	);
}

async function archives(rig: Rig, backend: With<"archive">, ref: SessionRef): Promise<void> {
	const cwd = rig.driver.cwd;
	expect((await backend.archive(ref, true)).status === "accepted", "archive was rejected");
	expect(await listed(backend, { cwd, archived: true }, ref), "an archived session is not listed as archived");
	expect(!(await listed(backend, { cwd, archived: false }, ref)), "an archived session is still listed as active");
	expect((await backend.archive(ref, false)).status === "accepted", "unarchive was rejected");
	expect(await listed(backend, { cwd, archived: false }, ref), "an unarchived session is not listed as active");
	expect(!(await listed(backend, { cwd, archived: true }, ref)), "an unarchived session is still listed as archived");
}

async function forks(backend: With<"fork">, ref: SessionRef): Promise<void> {
	const source = (await allTranscript(backend, ref, 200)).map((item) => item.kind);
	const whole = await backend.fork(ref, undefined);
	if (whole.status === "rejected") fail(`fork was rejected: ${whole.rejection.message}`);
	const summary = await backend.getSession(whole.session);
	if (summary.status === "rejected") fail("the fork cannot be found");
	expect(summary.summary.parent?.kind === "fork", "the fork's parent is not marked as a fork");
	expect(summary.summary.parent?.session.sessionId === ref.sessionId, "the fork names the wrong parent");
	const copied = (await allTranscript(backend, whole.session, 200)).map((item) => item.kind);
	expect(canonical(copied) === canonical(source), "the fork does not hold the whole history");
	const items = await allTranscript(backend, ref, 200);
	const answer = items.findIndex((item) => item.kind === "block" && item.block === "text");
	const answerItem = items[answer];
	expect(answerItem !== undefined, "the session has no answer to fork through");
	const partial = await backend.fork(ref, { itemId: answerItem.id, position: "through" });
	if (partial.status === "rejected") fail(`forking through the answer was rejected: ${partial.rejection.message}`);
	const through = await allTranscript(backend, partial.session, 200);
	expect(through.length === items.length - answer, "a fork through an item does not end at that item");
}

async function deletes(rig: Rig, backend: With<"delete">, ref: SessionRef): Promise<void> {
	expect((await backend.delete(ref)).status === "accepted", "delete was rejected");
	await rig.catalog.waitFor(
		(events) => events.find((event) => event.type === "session_removed" && event.session.sessionId === ref.sessionId),
		"session_removed",
	);
	const gone = await backend.getSession(ref);
	expect(gone.status === "rejected" && gone.rejection.code === "not_found", "a deleted session can still be read");
	expect(!(await listed(backend, { cwd: rig.driver.cwd, archived: false }, ref)), "a deleted session is still listed");
}

/**
 * Every declared op runs against a session's history and answers with its own result kind; an op
 * that rewrites history invalidates the transcript. Calls naming no session, or another backend's
 * op, are refused.
 */
export async function backendOpsAnswerInKind(rig: Rig): Promise<void> {
	const { backend } = rig;
	if (!backend.call) return;
	const call = backend.call.bind(backend);
	for (const op of rig.traits.backendOps) {
		const live = await rig.openNew();
		await rig.arrange(live.ref, { kind: "reply" });
		await live.run("Leave some history.");
		const made = await rig.driver.backendCall(live.ref, op);
		if (!made) fail(`the driver cannot build a ${op} call`);
		const mark = rig.catalog.items.length;
		const result = await call(made);
		if (result.status === "rejected") fail(`${op} was rejected: ${result.rejection.message}`);
		expect(result.result.kind === op, `${op} answered with a ${result.result.kind} result`);
		if (rewritesHistory(op)) {
			await rig.catalog.waitFor(
				(events) =>
					events
						.slice(mark)
						.find((event) => event.type === "transcript_invalidated" && event.session.sessionId === live.ref.sessionId),
				`transcript_invalidated after ${op}`,
			);
		}
		const nowhere = await call(withSession(made, crypto.randomUUID()));
		expect(
			nowhere.status === "rejected" && nowhere.rejection.code === "not_found",
			`${op} on no session must be not_found`,
		);
	}
	const foreign = await call(foreignCall(backend.id, crypto.randomUUID()));
	expect(
		foreign.status === "rejected" && foreign.rejection.code === "unsupported",
		"another backend's op must be rejected unsupported",
	);
}

function withSession(call: BackendCall, sessionId: string): BackendCall {
	return BackendCall.parse({ ...call, op: { ...call.op, sessionId } });
}

function foreignCall(backend: AgentBackend["id"], sessionId: string): BackendCall {
	return backend === "pi"
		? { backend: "claude-code", op: { kind: "rewind_files", sessionId, userItemId: "item", dryRun: true } }
		: { backend: "pi", op: { kind: "navigate_tree", sessionId, itemId: "item", summarize: false } };
}
