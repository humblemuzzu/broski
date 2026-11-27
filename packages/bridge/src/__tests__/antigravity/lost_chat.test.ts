/**
 * A new chat whose first turn agy never stored, across a restart of the bridge, end to end: a real bridge with the
 * Antigravity backend and a phone on its link socket, every `agy` it starts answering as `answering-agy.ts` says. The
 * bridge before the restart left its record of the chat, written as it writes it (`store/made.ts`): made, and the
 * person's first prompt sent. agy lists no such session (its recorded listing names none) and answers its
 * `session/load` as ACP says an agent answers one for a session it does not have; the session agy makes in its place
 * is ACP's documented `session/new` answer, since every recorded one names a session agy's recorded listing has.
 */

import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityBackendFactory } from "../../backends/antigravity/factory";
import { MadeSessions } from "../../backends/antigravity/store/made";
import type { SessionRef } from "../../contract";
import { fileLock } from "../../platform/file-lock";
import { fitImageBase64 } from "../../platform/image-fit";
import { journalsIn } from "../../server/json-lines-journal";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "../e2e/harness";
import { promptInput } from "../helpers/core-rig";
import { connectPhone, type LinkContractClient } from "../helpers/link-contract-client";
import { AnsweringAgy, recordedFrontInitialize, recordedListing, unknownSession } from "./answering-agy";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
afterAll(() => env.restore());

const FIRST_PROMPT = "Fix the login redirect and explain what was wrong";
/** protocol/v1/session-setup, "Creating a session" */
const DOCUMENTED_NEW_SESSION = { result: { sessionId: "sess_abc123def456" } };

function fail(message: string): never {
	throw new Error(message);
}

/** The lines of the journal of the sessions the bridge made, as the file holds them. */
function journaled(journals: string): Array<Record<string, unknown>> {
	const text = readFileSync(join(journals, "sessions.jsonl"), "utf8");
	return text
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line));
}

async function listed(phone: LinkContractClient) {
	const answer = await phone.ok("sessions.list", { backend: "antigravity", query: {}, page: { limit: 50 } });
	if (answer.result.status !== "accepted") throw new Error(`the list was refused: ${answer.result.rejection.message}`);
	return answer.result.page.items;
}

test("a chat agy lost to a restart is listed, opens as a new session in its place, and hands the person back their words", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-lost-")));
	const cwd = join(root, "project");
	mkdirSync(cwd);
	const journals = join(root, "antigravity");
	const lost = crypto.randomUUID();
	const before = new MadeSessions(journalsIn(journals, fail));
	before.note(lost, { cwd }, Date.UTC(2026, 10, 27, 9));
	before.prompted(lost, FIRST_PROMPT, { modes: [] });

	const agy = new AnsweringAgy(
		{
			initialize: [recordedFrontInitialize()],
			"session/load": [unknownSession(lost)],
			"session/new": [DOCUMENTED_NEW_SESSION],
		},
		recordedListing(),
	);
	const faults: string[] = [];
	const factory = antigravityBackendFactory({
		install: {
			cli: { found: false, reason: "every agy here answers from recordings" },
			env: {},
			voidDir: join(root, "void"),
			presenceDir: join(root, "presence"),
		},
		bridgeVersion: "0.0.0-test",
		fileLock,
		fitImage: fitImageBase64,
		journal: journalsIn(journals, fail),
		launch: agy.launch,
		log: (message) => faults.push(message),
	});
	const socketPath = join(root, "link.sock");
	const bridge = await startBridge({
		linkSocket: socketPath,
		contract: { backends: [["antigravity", factory]], journalDirectory: join(root, "core") },
	});
	try {
		const phone = await connectPhone(socketPath, "phone");
		await phone.hello();
		const old: SessionRef = { backend: "antigravity", sessionId: lost };
		expect(await listed(phone)).toContainEqual({
			session: old,
			title: { text: FIRST_PROMPT, source: "first_prompt" },
			cwd,
			updatedAt: Date.UTC(2026, 10, 27, 9),
			status: "idle",
			origin: "broski",
		});
		expect((await phone.ok("session.get", { session: old })).result).toMatchObject({ status: "accepted" });

		const attached = await phone.ok("session.attach", { session: old });
		if (attached.sync.kind !== "snapshot") throw new Error(`the attach gave ${attached.sync.kind}`);
		const { epoch, lastSeq, snapshot } = attached.sync;
		expect(snapshot.run).toBeUndefined();
		const replaced = await phone.waitForEvent(
			old,
			(envelope) => envelope.event.type === "session_replaced",
			"the move",
		);
		const next: SessionRef = { backend: "antigravity", sessionId: "sess_abc123def456" };
		expect(replaced.event).toEqual({ type: "session_replaced", session: next });
		const after = phone.envelopes(old).filter((envelope) => envelope.seq > lastSeq);
		expect(after.map((envelope) => envelope.event)).toEqual([
			{ type: "input_returned", texts: [FIRST_PROMPT] },
			{ type: "session_replaced", session: next },
		]);
		expect(agy.sent(true)).toEqual(["session/load", "session/new"]);
		expect(agy.written.find((record) => record.method === "session/new")?.params).toEqual({ cwd, mcpServers: [] });

		const followed = await phone.ok("session.attach", { session: next });
		expect(followed.sync.kind).toBe("snapshot");
		const back = await connectPhone(socketPath, "back");
		await back.hello();
		const resumed = await back.ok("session.attach", { session: old, resume: { epoch, seq: lastSeq } });
		expect(resumed.sync).toEqual({ kind: "replaced", epoch, session: next });

		const rows = await listed(phone);
		expect(rows.map((row) => row.session.sessionId)).not.toContain(lost);
		expect(rows.find((row) => row.session.sessionId === next.sessionId)?.title).toEqual({
			text: FIRST_PROMPT,
			source: "first_prompt",
		});
		expect(journaled(journals).at(-1)).toEqual({
			sessionId: next.sessionId,
			at: expect.any(Number),
			options: { cwd, modes: [] },
			firstPrompt: FIRST_PROMPT,
			carried: true,
			replaces: lost,
		});

		await phone.ok("prompt", { session: next, input: promptInput(FIRST_PROMPT) });
		expect(agy.sent(true)).toEqual(["session/load", "session/new", "session/prompt"]);
		expect(agy.written.at(-1)?.params).toEqual({
			sessionId: next.sessionId,
			prompt: [{ type: "text", text: FIRST_PROMPT }],
		});
		expect(journaled(journals).at(-1)).toMatchObject({ sessionId: next.sessionId, firstPrompt: FIRST_PROMPT });
		expect(journaled(journals).at(-1)?.carried).toBeUndefined();
		expect(faults).toEqual([]);
	} finally {
		await bridge.stop();
		rmSync(root, { recursive: true, force: true });
	}
});
