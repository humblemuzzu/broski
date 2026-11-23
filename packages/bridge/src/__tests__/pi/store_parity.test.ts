/**
 * The store's reading of a session file against the pinned SDK's own: `SessionManager.list` (pi-coding-agent
 * `src/core/session-manager.ts:799-882`) over the same directory. Title (the first prompt's line, cut where every
 * listing cuts it), creation and modification time, cwd and parent are compared field by field; the files avoid U+2028/U+2029, which the SDK's `readline` splits on.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { TITLE_CHARS } from "../../backends/pi/mapping/prompt-title";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { imageBlock, iso, SessionBuilder, T0, textBlock, toolCall, writeSession } from "./store_fixtures";

let env: PiTestEnv;

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(() => {
	env.dispose();
});

function fixtures(): SessionBuilder[] {
	const make = (id: string, extra: Partial<ConstructorParameters<typeof SessionBuilder>[0]> = {}) =>
		new SessionBuilder({ id, cwd: env.cwd, version: 3, createdAt: 1_000, ...extra });
	const plain = make("plain");
	plain.user("hello there", 2_000);
	plain.assistant([textBlock("hi")], 3_000);

	const renamed = make("renamed");
	renamed.user("first", 2_000);
	renamed.sessionInfo("First name", 2_100);
	renamed.sessionInfo("  Second\tname  ", 2_200);

	const cleared = make("cleared");
	cleared.user("to be cleared", 2_000);
	cleared.sessionInfo("Gone", 2_100);
	cleared.sessionInfo("   ", 2_200);

	const imageFirst = make("image-first");
	imageFirst.user([imageBlock("AAAA")], 2_000);
	imageFirst.user([textBlock("the real"), textBlock("prompt")], 2_100);

	const blank = make("blank");
	blank.user("   \n\t ", 2_000);
	blank.user("a later one", 2_100);

	const bare = make("bare");
	bare.custom("x", undefined, 1_500);

	const stepped = make("stepped");
	stepped.user("one", 5_000);
	stepped.assistant([textBlock("two")], 4_000);
	stepped.user("three", 3_000);

	const entryTimes = make("entry-times");
	entryTimes.raw({
		type: "message",
		id: "e1",
		parentId: null,
		timestamp: iso(8_000),
		message: { role: "user", content: "no message time" },
	});

	const long = make("long");
	long.user(`${"word ".repeat(2_000)}end`, 2_000);

	const badDate = make("bad-date");
	badDate.lines[0] = { type: "session", version: 3, id: "bad-date", timestamp: "not a date", cwd: env.cwd };
	badDate.user("dated by the file", 2_000);

	const fork = make("fork", { parentSession: join(env.sessionDir, "somewhere-else.jsonl") });
	fork.user("forked prompt", 2_000);

	const v1 = new SessionBuilder({ id: "old-v1", cwd: env.cwd, createdAt: 500 });
	v1.user("version one", 600);
	v1.assistant([textBlock("answer")], 700);
	const v2 = make("old-v2", { version: 2 });
	v2.user("version two", 2_000);

	const widened = make("widened");
	widened.user("question", 2_000);
	widened.assistant([textBlock("answer")], 2_500);
	for (let n = 0; n < 4; n += 1) widened.toolResult(`c${n}`, "r".repeat(100_000), 3_000 + n);
	widened.assistant([toolCall("x")], 4_000);

	return [plain, renamed, cleared, imageFirst, blank, bare, stepped, entryTimes, long, badDate, fork, v1, v2, widened];
}

test("title, times, cwd and parent agree with SessionManager.list for every kind of file Pi writes", async () => {
	const paths = new Map(fixtures().map((builder) => [builder.options.id, writeSession(env.sessionDir, builder)]));
	utimesSync(paths.get("bad-date") ?? "", new Date(T0 + 50_000), new Date(T0 + 50_000));
	const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
	const title = (text: string) => {
		const line = oneLine(text);
		return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS).trimEnd()}…` : line;
	};

	const theirs = await SessionManager.list(env.cwd, env.sessionDir);
	const index = new SessionIndex(piSessionDirs(env.agentDir));
	const ours = await Promise.all((await index.scan(env.cwd)).map((head) => index.complete(head)));

	expect(ours.map((row) => row.sessionId).sort()).toEqual(theirs.map((info) => info.id).sort());
	for (const info of theirs) {
		const row = ours.find((candidate) => candidate.sessionId === info.id);
		if (row === undefined) throw new Error(`${info.id} is not listed`);
		const compared = {
			id: info.id,
			cwd: row.cwd,
			name: row.name,
			prompt: row.firstPrompt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			parent: row.parentPath,
		};
		const expected = {
			id: info.id,
			cwd: info.cwd,
			name: info.name,
			prompt: info.firstMessage === "(no messages)" ? undefined : title(info.firstMessage) || undefined,
			createdAt: Number.isNaN(info.created.getTime()) ? undefined : info.created.getTime(),
			updatedAt: info.modified.getTime(),
			parent: info.parentSessionPath,
		};
		expect(compared).toEqual(expected);
	}
});

test("the SDK's own manager reads a rename, and a cleared name, as the store does", async () => {
	const path = writeSession(env.sessionDir, fixtures()[1] ?? new SessionBuilder({ id: "x", cwd: env.cwd }));
	const index = new SessionIndex(piSessionDirs(env.agentDir));
	const [head] = await index.scan(env.cwd);
	const row = head === undefined ? undefined : await index.complete(head);

	expect(row?.name).toBe(SessionManager.open(path, env.sessionDir).getSessionName());
});
