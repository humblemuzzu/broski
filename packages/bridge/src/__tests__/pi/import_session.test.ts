/**
 * `import_session`: a session file arriving from the phone in parts, judged as Pi reads session files, put in the
 * sessions directory of its project, listed, and never laid over a session that is already here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scratch } from "../../backends/pi/transfer/scratch";
import { UploadDesk } from "../../backends/pi/transfer/upload-desk";
import { type BackendCallResult, MAX_IMPORT_BYTES, type SessionRef } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { say } from "./helpers/scenarios";
import { conversation, readEntries, writeSessionFile } from "./helpers/session-files";
import { accepted, callPi, readExport, uploadSession, withSessionId } from "./helpers/transfer-calls";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;
const scratch: string[] = [];

afterEach(async () => {
	await t?.dispose();
	t = undefined;
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const text = (value: string) => Buffer.from(value);

function reason(result: BackendCallResult): string {
	if (result.status === "accepted") throw new Error(`expected a refusal, got ${JSON.stringify(result.result)}`);
	return `${result.rejection.code}: ${result.rejection.message}`;
}

async function ranSession(rig: LiveRig): Promise<SessionRef> {
	const live = await rig.rig.openNew();
	rig.router.script(live.ref.sessionId, [say("The answer is forty-two.")]);
	const mark = live.recorder.items.length;
	await live.prompt("what is the answer");
	await live.runAfter(mark);
	await rig.driver.quiesce();
	await live.close();
	return live.ref;
}

function header(rig: LiveRig, id: string, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: "session",
		version: 3,
		id,
		timestamp: "2026-02-03T04:05:06.000Z",
		cwd: rig.cwd,
		...extra,
	});
}

function entry(id: string, parentId: string | null, role: "user" | "assistant", body: string): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId,
		timestamp: "2026-02-03T04:05:07.000Z",
		message: { role, content: [{ type: "text", text: body }], timestamp: 0 },
	});
}

function file(...lines: string[]): Buffer {
	return text(`${lines.join("\n")}\n`);
}

describe("importing a session file", () => {
	test("puts an exported session back as a session of its own, listed, with the same conversation", async () => {
		t = await LiveRig.create();
		const original = await ranSession(t);
		const exported = await readExport(t.backend, original.sessionId, "jsonl");
		const id = crypto.randomUUID();
		const copy = withSessionId(exported.bytes, id);

		const result = await uploadSession(t.backend, "upload-1", copy, 4_096);
		expect(accepted(result, "import_session")).toEqual({
			kind: "import_session",
			received: copy.length,
			sessionId: id,
		});

		const row = await t.backend.getSession({ backend: "pi", sessionId: id });
		expect(row.status === "accepted" && row.summary.origin).toBe("broski");
		const listed = await t.backend.listSessions({ cwd: t.cwd, archived: false }, { limit: 50 });
		expect(listed.status === "accepted" && listed.page.items.map((session) => session.session.sessionId)).toContain(id);
		const read = await t.backend.readTranscript({ backend: "pi", sessionId: id }, { limit: 50 });
		const texts =
			read.status === "accepted" ? read.page.items.flatMap((item) => ("text" in item ? [item.text] : [])) : [];
		expect(texts).toContain("The answer is forty-two.");

		const placed = readdirSync(t.world.sessionsRoot).filter((name) => name.endsWith(`_${id}.jsonl`));
		expect(placed).toHaveLength(1);
		const bytes = readFileSync(join(t.world.sessionsRoot, placed[0] ?? ""));
		expect(bytes.subarray(0, copy.length).equals(copy)).toBe(true);
		const marks = readEntries(join(t.world.sessionsRoot, placed[0] ?? "")).filter(
			(line) => line.type === "custom" && line.customType === "broski.origin",
		);
		expect(marks).toHaveLength(1);
	});

	test("takes a file past the size of a part, in full-size parts, and reads it back byte for byte", async () => {
		t = await LiveRig.create();
		const long = "a line of a long conversation. ".repeat(4_000);
		const turns = Array.from({ length: 30 }, (_, index) => `${index} ${long}`);
		writeSessionFile(t.world.sessionsRoot, { id: "big", cwd: t.cwd, version: 3 }, conversation(turns));
		const exported = await readExport(t.backend, "big", "jsonl");
		expect(exported.parts).toBeGreaterThan(2);

		const copy = withSessionId(exported.bytes, "big-copy");
		const result = await uploadSession(t.backend, "u", copy);
		expect(accepted(result, "import_session").sessionId).toBe("big-copy");
		const back = await readExport(t.backend, "big-copy", "jsonl");
		expect(back.bytes.subarray(0, copy.length).equals(copy)).toBe(true);
	});

	test("tells the catalog about the new session", async () => {
		t = await LiveRig.create();
		const id = "imported-1";
		const mark = t.catalog.items.length;
		await uploadSession(t.backend, "u", file(header(t, id), entry("a1", null, "user", "hello")));
		await t.catalog.waitFor(
			(events) =>
				events.slice(mark).find((event) => event.type === "session_updated" && event.summary.session.sessionId === id),
			"session_updated for the imported session",
		);
	});

	test("reads an upload in as many parts as the phone sends, in order", async () => {
		t = await LiveRig.create();
		const body = file(header(t, "parts-1"), entry("a1", null, "user", "x".repeat(20_000)));
		const result = await uploadSession(t.backend, "u", body, 1_000);
		expect(accepted(result, "import_session").received).toBe(body.length);
		expect(existsSync(t.world.sessionsRoot)).toBe(true);
	});

	test("takes a version 1 file, which has no entry ids, as Pi does", async () => {
		t = await LiveRig.create();
		const old = file(
			JSON.stringify({ type: "session", id: "old-1", timestamp: "2025-01-01T00:00:00.000Z", cwd: t.cwd }),
			JSON.stringify({
				type: "message",
				timestamp: "2025-01-01T00:00:01.000Z",
				message: { role: "user", content: "hi", timestamp: 0 },
			}),
		);
		expect(accepted(await uploadSession(t.backend, "u", old), "import_session").sessionId).toBe("old-1");
	});

	test("never replaces a session that is already here: the id, and the file, stay as they were", async () => {
		t = await LiveRig.create();
		const path = writeSessionFile(
			t.world.sessionsRoot,
			{ id: "taken", cwd: t.cwd, version: 3 },
			conversation(["mine", "mine too"]),
		);
		const before = readFileSync(path);
		const other = file(header(t, "taken"), entry("z1", null, "user", "someone else's"));
		expect(reason(await uploadSession(t.backend, "u", other))).toContain("already on this Mac");
		expect(readFileSync(path).equals(before)).toBe(true);
		expect(readdirSync(t.world.sessionsRoot).filter((name) => name.includes("taken"))).toHaveLength(1);
	});

	test("never replaces a file of the name the import would take", async () => {
		t = await LiveRig.create();
		const name = "2026-02-03T04-05-06-000Z_named.jsonl";
		const squatter = join(t.world.sessionsRoot, name);
		writeFileSync(squatter, "not a session, and not to be replaced\n");
		const result = await uploadSession(t.backend, "u", file(header(t, "named"), entry("a1", null, "user", "hello")));
		expect(reason(result)).toContain("invalid_input");
		expect(readFileSync(squatter, "utf8")).toBe("not a session, and not to be replaced\n");
	});

	test("keeps nothing from an upload it refused", async () => {
		t = await LiveRig.create();
		const before = readdirSync(t.world.sessionsRoot);
		await uploadSession(t.backend, "u", text("this is not a session\n"));
		expect(readdirSync(t.world.sessionsRoot)).toEqual(before);
	});
});

describe("refusing a file that is not a session", () => {
	test.each([
		["an empty file", text(""), "the file is empty"],
		["text", text("just some words\n"), "line 1 is not valid JSON"],
		["a JSON array", text("[1,2,3]\n"), "line 1 is not a JSON object"],
		[
			"a first line that is no header",
			file(JSON.stringify({ type: "message", id: "m" })),
			"line 1 is not a Pi session header",
		],
		[
			"a header without a project directory",
			file(JSON.stringify({ type: "session", id: "x", version: 3 })),
			"names no project directory",
		],
	])("%s", async (_name, bytes, why) => {
		t = await LiveRig.create();
		const result = await uploadSession(t.backend, "u", bytes);
		const text = reason(result);
		expect(text).toContain("invalid_input");
		expect(text).toContain(why);
	});

	test("a damaged line in the middle names the line", async () => {
		t = await LiveRig.create();
		const result = await uploadSession(
			t.backend,
			"u",
			file(
				header(t, "damaged"),
				entry("a1", null, "user", "ok"),
				'{"type":"message","id":"a2"',
				entry("a3", "a1", "assistant", "fine"),
			),
		);
		expect(reason(result)).toContain("line 3 is not valid JSON");
	});

	test("an entry id that repeats, and an entry without one in a version 3 file", async () => {
		t = await LiveRig.create();
		const repeated = file(header(t, "rep"), entry("a1", null, "user", "one"), entry("a1", "a1", "assistant", "two"));
		expect(reason(await uploadSession(t.backend, "u1", repeated))).toContain("line 3 repeats the entry id a1");
		const missing = file(
			header(t, "miss"),
			JSON.stringify({ type: "message", message: { role: "user", content: "x" } }),
		);
		expect(reason(await uploadSession(t.backend, "u2", missing))).toContain("line 2 is an entry without an id");
	});

	test("a session id that could be a path", async () => {
		t = await LiveRig.create();
		for (const id of ["../escape", "a/b", "..", ".hidden", "x".repeat(200)]) {
			const result = await uploadSession(t.backend, `u-${id.length}`, file(header(t, id)));
			expect(reason(result)).toContain("a session id Pi would not use");
		}
		expect(existsSync(join(t.world.sessionsRoot, "..", "escape"))).toBe(false);
	});

	test("a session whose project directory is not on this Mac says so", async () => {
		t = await LiveRig.create();
		const result = await uploadSession(t.backend, "u", file(header(t, "away", { cwd: "/definitely/not/here" })));
		expect(reason(result)).toContain("/definitely/not/here is not on this Mac");
	});

	test("a part that is not base64", async () => {
		t = await LiveRig.create();
		const result = await callPi(t.backend, {
			kind: "import_session",
			uploadId: "u",
			offset: 0,
			data: "not base64!",
			last: false,
		});
		expect(reason(result)).toContain("not base64");
	});
});

describe("the parts of an upload", () => {
	test("must arrive in order: a wrong offset says how many bytes the Mac holds", async () => {
		t = await LiveRig.create();
		const { backend } = t;
		const part = (offset: number, data: string, last = false) =>
			callPi(backend, {
				kind: "import_session",
				uploadId: "u",
				offset,
				data: Buffer.from(data).toString("base64"),
				last,
			});
		expect(accepted(await part(0, "abcd"), "import_session").received).toBe(4);
		expect(reason(await part(2, "ef"))).toContain("holds 4 bytes");
		expect(reason(await part(9, "ef"))).toContain("holds 4 bytes");
		expect(accepted(await part(4, "ef"), "import_session").received).toBe(6);
	});

	test("start over at offset 0, and an upload the Mac never saw cannot continue", async () => {
		t = await LiveRig.create();
		const { backend } = t;
		const part = (uploadId: string, offset: number, data: string) =>
			callPi(backend, {
				kind: "import_session",
				uploadId,
				offset,
				data: Buffer.from(data).toString("base64"),
				last: false,
			});
		accepted(await part("u", 0, "abcdef"), "import_session");
		expect(accepted(await part("u", 0, "xy"), "import_session").received).toBe(2);
		expect(reason(await part("nobody", 5, "xy"))).toContain("holds no part of this upload");
	});

	test("are bounded: an upload past the largest session file is refused and dropped", async () => {
		const area = new Scratch();
		const desk = new UploadDesk(area, { limit: 10 });
		try {
			expect(await desk.take("u", 0, Buffer.from("12345678"))).toBe(8);
			const refused = await desk.take("u", 8, Buffer.from("90123"));
			expect(typeof refused === "number" ? refused : refused.rejection.code).toBe("invalid_input");
			expect(await desk.pathOf("u")).toBeUndefined();
		} finally {
			await area.dispose();
		}
		expect(MAX_IMPORT_BYTES).toBeGreaterThan(10);
	});
});

describe("where an import may write", () => {
	test("not through a link that leads out of the sessions directories", async () => {
		t = await LiveRig.create({ sessionsAt: "default" });
		const outside = mkdtempSync(join(tmpdir(), "broski-pi-outside-"));
		scratch.push(outside);
		const root = join(t.world.env.agentDir, "sessions");
		mkdirSync(root, { recursive: true });
		const projectDir = join(root, `--${t.cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
		symlinkSync(outside, projectDir);

		const result = await uploadSession(t.backend, "u", file(header(t, "escaping"), entry("a1", null, "user", "hello")));
		expect(reason(result)).toContain("unsupported");
		expect(readdirSync(outside)).toEqual([]);
	});

	test("into the default directory for the project when the sessions root does not exist yet", async () => {
		t = await LiveRig.create({ sessionsAt: "default" });
		const result = await uploadSession(t.backend, "u", file(header(t, "fresh"), entry("a1", null, "user", "hello")));
		expect(accepted(result, "import_session").sessionId).toBe("fresh");
		const listed = await t.backend.listSessions({ cwd: t.cwd, archived: false }, { limit: 50 });
		expect(listed.status === "accepted" && listed.page.items.map((session) => session.session.sessionId)).toContain(
			"fresh",
		);
	});
});
