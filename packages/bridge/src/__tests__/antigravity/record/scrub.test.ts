/**
 * The recorder's scrubber on frames built here, shaped as agy's but holding the run's home folder and this Mac's user
 * and host names: a listing row that is not the recording's keeps only its shape whichever of its optional fields it
 * carries, everything agy says under `_meta.antigravity` is redacted whatever its type, the Gemini API key, the home
 * folder and the name of each temp folder are replaced wherever and however they are spelled, and a time written with a
 * UTC offset is the same instant in UTC.
 */

import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";
import type { Frame } from "../live/wire-log";
import { scrubbed } from "./scrub";

const OURS = "11111111-2222-4333-8444-555555555555";
const FOREIGN = [1, 2, 3, 4, 5, 6].map((n) => `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${n}`);
const UPDATED = "2026-11-27T09:00:00.000Z";
const API_KEY = "scrub-test-gemini-key-not-real";
const SECRETS = ["Plan the launch", "Private title", "Nested secret", "Pro plan", "plan-x", "quota note", "a summary"];

const home = homedir();
/** A folder of the user's outside the temp folder, wherever this run puts the home folder. */
const WORK = "/Volumes/Work";
const temp = realpathSync(tmpdir());
const root = join(temp, "broski-agy-live-scrubRT");
const roots = { ROOT: root, OTHER: join(temp, "broski-agy-live-other-scrubOT") };
const paths = {
	workspace: join(temp, "broski-agy-live-scrubWS"),
	voidDir: join(root, "void"),
	roots,
	ours: new Set([OURS]),
};
const NAMES = { workspace: basename(paths.workspace), root: basename(roots.ROOT), other: basename(roots.OTHER) };

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
	const named = [
		home,
		encodeURIComponent(home),
		encodeURI(home),
		...FOREIGN,
		OURS,
		...SECRETS,
		...Object.values(NAMES),
	];
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

	test("the Gemini API key is replaced wherever it stands", () => {
		const [frame] = scrubbed(
			[
				{
					tapPid: 1,
					pid: 2,
					args: ["acp"],
					startedAt: 0,
					frames: [{ at: 0, from: "agent", message: { error: { message: `key ${API_KEY} was refused` } } }],
				},
			],
			{ ...paths, apiKey: API_KEY },
		);
		expect(frame?.frames[0]?.message).toEqual({ error: { message: "key <GEMINI_API_KEY> was refused" } });
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

	test("each temp folder's name is replaced wherever it stands, as in a path agy wrote from one of them to another", () => {
		const { workspace, root: rootName, other } = NAMES;
		const [frame] = scrub({
			method: "session/update",
			params: {
				sessionId: OURS,
				update: {
					sessionUpdate: "tool_call",
					title: `File ../../${workspace}/notes.txt`,
					content: [{ type: "text", text: `ls ../${rootName}/void, then ${other.toUpperCase()}` }],
					locations: [{ path: join(paths.workspace, "notes.txt") }, { path: join(roots.OTHER, "x") }],
				},
			},
		});
		expect(frame?.params).toEqual({
			sessionId: expect.any(String),
			update: {
				sessionUpdate: "tool_call",
				title: "File ../../<WORKSPACE_NAME>/notes.txt",
				content: [{ type: "text", text: "ls ../<ROOT_NAME>/void, then <OTHER_NAME>" }],
				locations: [{ path: "<WORKSPACE>/notes.txt" }, { path: "<TMPDIR>/<OTHER_NAME>/x" }],
			},
		});
		expect(leaks(JSON.stringify(frame))).toEqual([]);
	});

	test("a time written with a UTC offset is that instant in UTC, to the precision it was written with", () => {
		const written = [
			"Created At: 2026-11-27T17:15:30+05:30\nCompleted At: 2026-11-27T17:15:30+05:30",
			"2026-12-31T23:30-01:00 and 2026-03-01T01:15:30.250+05:45",
			"2026-11-27T11:45:30Z, 2026-11-27T11:45:30+00:00, 2026-13-40T99:00:00+01:00",
		];
		const [frame] = scrub({ id: 5, result: { output: written.join("\n"), times: written.slice(1) } });
		const utc = [
			"Created At: 2026-11-27T11:45:30Z\nCompleted At: 2026-11-27T11:45:30Z",
			"2027-01-01T00:30Z and 2026-02-28T19:30:30.250Z",
			"2026-11-27T11:45:30Z, 2026-11-27T11:45:30Z, 2026-13-40T99:00:00+01:00",
		];
		expect(frame?.result).toEqual({ output: utc.join("\n"), times: utc.slice(1) });
	});
});
