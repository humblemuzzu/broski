/**
 * The recorder's scrubber on frames built here, shaped as agy's but holding the run's home folder and this Mac's user
 * and host names: a listing row that is not the recording's keeps only its shape whichever of its optional fields it carries,
 * everything agy says under `_meta.antigravity` is redacted whatever its type, and the home folder is replaced wherever
 * and however it is spelled.
 */

import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { Frame } from "../live/wire-log";
import { scrubbed } from "./scrub";

const OURS = "11111111-2222-4333-8444-555555555555";
const FOREIGN = [1, 2, 3, 4, 5, 6].map((n) => `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${n}`);
const UPDATED = "2026-11-27T09:00:00.000Z";
const SECRETS = ["Plan the launch", "Private title", "Nested secret", "Pro plan", "plan-x", "quota note", "a summary"];

const home = homedir();
/** A folder of the user's outside the temp folder, wherever this run puts the home folder. */
const WORK = "/Volumes/Work";
const root = join(realpathSync(tmpdir()), "broski-agy-live-scrub");
const paths = { workspace: join(root, "work"), voidDir: join(root, "void"), ours: new Set([OURS]) };

function scrub(...messages: Frame["message"][]): Frame["message"][] {
	const frames = messages.map((message, at): Frame => ({ at, from: "agent", message }));
	const [agy] = scrubbed([{ tapPid: 1, pid: 2, args: ["acp"], startedAt: 0, frames }], paths);
	return agy?.frames.map((frame) => frame.message) ?? [];
}

function listing(sessions: unknown[]): Frame["message"] {
	return { jsonrpc: "2.0", id: 1, result: { sessions } };
}

/** The strings of this Mac and of the conversations that must not survive the scrub. */
function leaks(scrubbedText: string): string[] {
	const user = userInfo().username;
	const host = hostname().split(".")[0] ?? "";
	const named = [home, encodeURIComponent(home), encodeURI(home), ...FOREIGN, OURS, ...SECRETS];
	return [...named, ...[user, host].filter((name) => name.length >= 4)].filter((text) => scrubbedText.includes(text));
}

describe("the recorder's scrubber", () => {
	test("a listed conversation that is not the recording's keeps only its shape, whichever fields it carries", () => {
		const [frame] = scrub(
			listing([
				{ sessionId: OURS, cwd: paths.workspace, title: "Reply with exactly: ok", updatedAt: UPDATED },
				{ sessionId: FOREIGN[0], cwd: join(WORK, "Plan the launch"), title: "Plan the launch", updatedAt: UPDATED },
				{ sessionId: FOREIGN[1], cwd: encodeURIComponent(join(WORK, "Code", "app")), title: "Private title" },
				{ sessionId: FOREIGN[2] },
				{ sessionId: FOREIGN[3], title: { text: "Nested secret", by: home }, cwd: [join(home, "x")] },
				{ sessionId: FOREIGN[4], cwd: paths.voidDir, summary: "a summary", _meta: { note: `${home}/quota note` } },
				{ cwd: join(WORK, "no id"), title: "Private title", updatedAt: UPDATED },
			]),
		);
		expect(frame?.result).toEqual({
			sessions: [
				{ sessionId: expect.any(String), cwd: "<WORKSPACE>", title: "Reply with exactly: ok", updatedAt: UPDATED },
				{ sessionId: expect.any(String), cwd: "/Users/me/Project 1", title: "Conversation 1", updatedAt: UPDATED },
				{ sessionId: expect.any(String), cwd: encodeURIComponent("/Users/me/Project 2"), title: "Conversation 2" },
				{ sessionId: expect.any(String) },
				{ sessionId: expect.any(String), title: { text: "<REDACTED>", by: "<REDACTED>" }, cwd: ["<REDACTED>"] },
				{ sessionId: expect.any(String), cwd: "<VOID>", summary: "<REDACTED>", _meta: { note: "<REDACTED>" } },
				{ cwd: "/Users/me/Project 6", title: "Conversation 6", updatedAt: UPDATED },
			],
		});
		expect(leaks(JSON.stringify(frame))).toEqual([]);
	});

	test("everything agy says under _meta.antigravity is redacted whatever its type, and a null stays null", () => {
		const [object, text, none] = scrub(
			{ id: 2, result: { sessionId: OURS, _meta: { antigravity: { tier: { name: "Pro plan", id: 7 }, quota: 3 } } } },
			{ id: 3, result: { _meta: { antigravity: { tier: "plan-x", plans: ["Pro plan"] } } } },
			{ id: 4, result: { _meta: { antigravity: { tier: null } } } },
		);
		expect(object?.result).toEqual({
			sessionId: expect.any(String),
			_meta: { antigravity: { tier: "<REDACTED>", quota: "<REDACTED>" } },
		});
		expect(text?.result).toEqual({ _meta: { antigravity: { tier: "<REDACTED>", plans: "<REDACTED>" } } });
		expect(none?.result).toEqual({ _meta: { antigravity: { tier: null } } });
		expect(leaks(JSON.stringify([object, text, none]))).toEqual([]);
	});

	test("the phone note the bridge sends under _meta.antigravity stays, scrubbed as any text", () => {
		const [sent] = scrub({
			method: "session/new",
			params: { cwd: paths.workspace, _meta: { antigravity: { systemPrompt: { append: `Write for ${home}.` } } } },
		});
		expect(sent?.params).toEqual({
			cwd: "<WORKSPACE>",
			_meta: { antigravity: { systemPrompt: { append: "Write for /Users/me." } } },
		});
	});

	test("the home folder, the user and the Mac are replaced in nested strings however they are spelled", () => {
		const docs = join(home, "My Docs", "notes.txt");
		const [frame] = scrub({
			method: "session/update",
			params: {
				sessionId: OURS,
				update: {
					content: [{ type: "text", text: `cat ${docs} on ${hostname()} as ${userInfo().username}` }],
					locations: [{ uri: `file://${encodeURI(docs)}` }, { path: encodeURIComponent(docs) }],
					rawInput: { nested: { deeper: [`ls ${home}`] }, accountEmail: { address: "someone@example.org" } },
				},
			},
		});
		expect(leaks(JSON.stringify(frame))).toEqual([]);
		expect(JSON.stringify(frame)).toContain("/Users/me/My Docs/notes.txt");
		expect(JSON.stringify(frame)).toContain(encodeURIComponent("/Users/me/My Docs/notes.txt"));
		expect(frame?.params).toMatchObject({ update: { rawInput: { accountEmail: "<REDACTED>" } } });
	});
});
