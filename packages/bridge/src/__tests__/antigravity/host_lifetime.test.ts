/**
 * How long a session stays hosted, on the production backend with room for one, every `agy` it starts answering as
 * `answering-agy.ts` says: the first session is ACP's documented `session/new` answer, the second the one agy gave in
 * the `plain-turn` recording, and agy's `session/close` answer is the one of the `load-replay` recording.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityBackendOf } from "../../backends/antigravity/backend";
import { PresenceLocks } from "../../backends/antigravity/live/lock";
import type { OpenResult, Rejected } from "../../contract";
import { fileLock } from "../../platform/file-lock";
import { fitImageBase64 } from "../../platform/image-fit";
import { journalsIn } from "../../server/json-lines-journal";
import { promptInput } from "../helpers/core-rig";
import { AnsweringAgy, recordedFrontInitialize } from "./answering-agy";
import { answerTo } from "./replay/recorded";
import { frontOf, jobOf, recording } from "./replay/recordings";

let root: string | undefined;

afterEach(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

/** protocol/v1/session-setup, "Creating a session" */
const DOCUMENTED_NEW_SESSION = { result: { sessionId: "sess_abc123def456" } };

function opened(result: OpenResult): Exclude<OpenResult, Rejected> {
	if (result.status === "rejected") throw new Error(`the open was refused: ${result.rejection.message}`);
	return result;
}

test("a session whose view closed stays hosted, holding agy's lock, until another needs its room", async () => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-hosts-")));
	const cwd = join(root, "project");
	const presenceDir = join(root, "presence");
	mkdirSync(cwd);
	const agy = new AnsweringAgy(
		{
			initialize: [recordedFrontInitialize()],
			"session/new": [DOCUMENTED_NEW_SESSION, { result: answerTo(frontOf(recording("plain-turn")), "session/new") }],
			"session/close": [{ result: answerTo(jobOf(recording("load-replay")), "session/close") }],
		},
		{},
	);
	const faults: string[] = [];
	const backend = antigravityBackendOf(
		{
			install: {
				cli: { found: false, reason: "every agy here answers from recordings" },
				env: {},
				voidDir: join(root, "void"),
				presenceDir,
			},
			bridgeVersion: "0.0.0-test",
			fileLock,
			fitImage: fitImageBase64,
			journal: journalsIn(join(root, "antigravity"), (message) => faults.push(message)),
			launch: agy.launch,
			maxSessions: 1,
			log: (message) => faults.push(message),
		},
		{ catalog: { emit: () => undefined } },
	);
	const sink = { emit: () => undefined };
	const locks = new PresenceLocks(presenceDir, fileLock);
	try {
		const first = opened(await backend.open({ kind: "new", options: { cwd } }, sink));
		const ref = first.session.session;
		expect(locks.heldElsewhere(ref.sessionId)).toBe(true);
		await first.session.close();
		await Bun.sleep(10);
		expect(agy.sent(true)).toEqual(["session/new"]);
		expect(locks.heldElsewhere(ref.sessionId)).toBe(true);

		const again = opened(await backend.open({ kind: "existing", session: ref }, sink));
		expect(again.session.session).toEqual(ref);
		expect(agy.sent(true)).toEqual(["session/new"]);
		await again.session.close();

		const second = opened(await backend.open({ kind: "new", options: { cwd } }, sink));
		expect(agy.sent(true)).toEqual(["session/new", "session/close", "session/new"]);
		expect(agy.written.find((record) => record.method === "session/close")?.params).toEqual({
			sessionId: ref.sessionId,
		});
		expect(locks.heldElsewhere(ref.sessionId)).toBe(false);

		const prompted = await second.session.control?.prompt(promptInput("Reply with exactly: ok"));
		expect(prompted).toEqual({ status: "accepted", disposition: "started" });
		expect(agy.sent(true).at(-1)).toBe("session/prompt");
		expect(faults).toEqual([]);
	} finally {
		await backend.dispose();
	}
});
