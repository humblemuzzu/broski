/**
 * `export_session` and `export_part` on real Pi sessions: a session run through the backend, and files a terminal
 * `pi` wrote. The file leaves as it is, every branch, up to its last complete line; the HTML is the terminal's
 * `/export`. Large files cross the frame limit in parts, each of which fits the smallest frame the link may carry.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TRANSFER_PART_BYTES, type SessionRef } from "../../contract";
import { encodeFrame } from "../../core/frame";
import { LiveRig } from "./helpers/live-rig";
import { say } from "./helpers/scenarios";
import { conversation, writeSessionFile } from "./helpers/session-files";
import { accepted, callPi, readExport } from "./helpers/transfer-calls";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

/** The smallest frame the link may be set to carry (`BROSKI_LINK_MESSAGE_MB` 1–8). */
const SMALLEST_FRAME_BYTES = 1_048_576;

async function ranSession(rig: LiveRig, prompt: string, answer: string): Promise<SessionRef> {
	const live = await rig.rig.openNew();
	rig.router.script(live.ref.sessionId, [say(answer)]);
	const mark = live.recorder.items.length;
	await live.prompt(prompt);
	await live.runAfter(mark);
	await rig.driver.quiesce();
	await live.close();
	return live.ref;
}

function externalSession(rig: LiveRig, id: string, turns: readonly string[]): { ref: SessionRef; path: string } {
	const path = writeSessionFile(rig.world.sessionsRoot, { id, cwd: rig.cwd, version: 3 }, conversation(turns));
	return { ref: { backend: "pi", sessionId: id }, path };
}

/** The session data a Pi HTML export embeds (`export-html/index.ts`, `{{SESSION_DATA}}`), as JSON text. */
function embeddedSession(html: string): string {
	const match = /<script id="session-data" type="application\/json">([^<]*)<\/script>/.exec(html);
	if (match?.[1] === undefined) throw new Error("the HTML embeds no session data");
	return Buffer.from(match[1], "base64").toString("utf8");
}

function frameOf(result: Awaited<ReturnType<typeof callPi>>): number {
	return encodeFrame({ type: "backend.call.result", requestId: "r", result }).bytes;
}

describe("exporting a session as its file", () => {
	test("is the file of a session run through the backend, byte for byte", async () => {
		t = await LiveRig.create();
		const ref = await ranSession(t, "write me a haiku", "Autumn moonlight, a worm digs silently");
		const exported = await readExport(t.backend, ref.sessionId, "jsonl");
		expect(exported.bytes.equals(readFileSync(t.fileOf(ref)))).toBe(true);
		expect(exported.mimeType).toBe("application/x-ndjson");
		expect(exported.name).toEndWith(`_${ref.sessionId}.jsonl`);
		expect(exported.bytes.toString("utf8").includes("Autumn moonlight")).toBe(true);
	});

	test("holds every branch of the file, not only the one the transcript shows", async () => {
		t = await LiveRig.create();
		const { ref, path } = externalSession(t, "branches", ["first", "answer", "second", "answer two"]);
		appendFileSync(
			path,
			`${JSON.stringify({ type: "message", id: "side", parentId: "e2", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "a side branch", timestamp: 0 } })}\n`,
		);
		const exported = await readExport(t.backend, ref.sessionId, "jsonl");
		expect(exported.bytes.equals(readFileSync(path))).toBe(true);
		expect(exported.bytes.toString("utf8").includes("a side branch")).toBe(true);
	});

	test("stops at the last complete line while a writer is mid-append", async () => {
		t = await LiveRig.create();
		const { ref, path } = externalSession(t, "torn", ["first", "answer"]);
		const complete = readFileSync(path);
		appendFileSync(path, '{"type":"message","id":"half');
		const exported = await readExport(t.backend, ref.sessionId, "jsonl");
		expect(exported.bytes.equals(complete)).toBe(true);
	});

	test("reads a file past the size of a part in parts, each of which fits the smallest frame the link carries", async () => {
		t = await LiveRig.create();
		const long = "a line of a long conversation. ".repeat(4_000);
		const turns = Array.from({ length: 40 }, (_, index) => `${index} ${long}`);
		const { ref, path } = externalSession(t, "large", turns);
		const size = statSync(path).size;
		expect(size).toBeGreaterThan(3 * MAX_TRANSFER_PART_BYTES);

		const made = accepted(
			await callPi(t.backend, { kind: "export_session", sessionId: ref.sessionId, format: "jsonl" }),
			"export_session",
		);
		expect(made.bytes).toBe(size);
		const chunks: Buffer[] = [];
		for (let offset = 0; ; ) {
			const read = await callPi(t.backend, {
				kind: "export_part",
				sessionId: ref.sessionId,
				exportId: made.exportId,
				offset,
			});
			expect(frameOf(read)).toBeLessThanOrEqual(SMALLEST_FRAME_BYTES);
			const part = accepted(read, "export_part");
			const bytes = Buffer.from(part.data, "base64");
			expect(part.offset).toBe(offset);
			expect(bytes.length).toBeLessThanOrEqual(MAX_TRANSFER_PART_BYTES);
			chunks.push(bytes);
			offset += bytes.length;
			expect(part.done).toBe(offset >= size);
			if (part.done) break;
		}
		expect(chunks.length).toBe(Math.ceil(size / MAX_TRANSFER_PART_BYTES));
		expect(Buffer.concat(chunks).equals(readFileSync(path))).toBe(true);
	});

	test("an unknown session is not found", async () => {
		t = await LiveRig.create();
		const missing = await callPi(t.backend, { kind: "export_session", sessionId: "nobody", format: "jsonl" });
		expect(missing).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});
});

describe("exporting a session as HTML", () => {
	test("renders the conversation as the terminal's /export does, and leaves the session file alone", async () => {
		t = await LiveRig.create();
		const ref = await ranSession(t, "explain the borrow checker", "Ownership moves; borrows lend.");
		const before = readFileSync(t.fileOf(ref));
		const exported = await readExport(t.backend, ref.sessionId, "html");
		const html = exported.bytes.toString("utf8");
		expect(exported.mimeType).toBe("text/html");
		expect(exported.name).toEndWith(`_${ref.sessionId}.html`);
		expect(html.trimStart().toLowerCase().startsWith("<!doctype html")).toBe(true);
		expect(html.trimEnd().endsWith("</html>")).toBe(true);
		const data = embeddedSession(html);
		expect(data.includes("explain the borrow checker")).toBe(true);
		expect(data.includes("Ownership moves; borrows lend.")).toBe(true);
		expect(data.includes(ref.sessionId)).toBe(true);
		expect(readFileSync(t.fileOf(ref)).equals(before)).toBe(true);
	});

	test("holds the messages of a session a terminal wrote, whose cwd it still has", async () => {
		t = await LiveRig.create();
		const { ref, path } = externalSession(t, "terminal-html", [
			"what is a monad",
			"A monoid in the category of endofunctors",
		]);
		const before = readFileSync(path);
		const exported = await readExport(t.backend, ref.sessionId, "html");
		const data = embeddedSession(exported.bytes.toString("utf8"));
		expect(data.includes("A monoid in the category of endofunctors")).toBe(true);
		expect(readFileSync(path).equals(before)).toBe(true);
	});

	test("renders a session whose project directory is gone", async () => {
		t = await LiveRig.create();
		const path = writeSessionFile(
			t.world.sessionsRoot,
			{ id: "orphan", cwd: join(t.cwd, "removed-project"), version: 3 },
			conversation(["hello", "hi"]),
		);
		expect(existsSync(path)).toBe(true);
		const exported = await readExport(t.backend, "orphan", "html");
		expect(embeddedSession(exported.bytes.toString("utf8")).includes("hello")).toBe(true);
	});

	test("reads an HTML past the size of a part in parts that join to the whole", async () => {
		t = await LiveRig.create();
		const long = "markdown to render and render again. ".repeat(2_000);
		const turns = Array.from({ length: 12 }, (_, index) => `${index} ${long}`);
		const { ref } = externalSession(t, "large-html", turns);
		const exported = await readExport(t.backend, ref.sessionId, "html");
		expect(exported.bytes.length).toBeGreaterThan(MAX_TRANSFER_PART_BYTES);
		expect(exported.parts).toBeGreaterThan(1);
		expect(exported.bytes.toString("utf8").trimEnd().endsWith("</html>")).toBe(true);
		expect(embeddedSession(exported.bytes.toString("utf8")).includes("11 markdown to render")).toBe(true);
	});
});

describe("reading an export", () => {
	test("refuses an export that was never made, another session's, and an offset past the end", async () => {
		t = await LiveRig.create();
		const one = externalSession(t, "one", ["a", "b"]);
		const two = externalSession(t, "two", ["c", "d"]);
		const made = accepted(
			await callPi(t.backend, { kind: "export_session", sessionId: "one", format: "jsonl" }),
			"export_session",
		);
		const { backend } = t;
		const read = (sessionId: string, exportId: string, offset: number) =>
			callPi(backend, { kind: "export_part", sessionId, exportId, offset });
		expect(await read(one.ref.sessionId, "no-such-export", 0)).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
		expect(await read(two.ref.sessionId, made.exportId, 0)).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
		expect(await read(one.ref.sessionId, made.exportId, made.bytes)).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
		expect(await read(one.ref.sessionId, made.exportId, made.bytes + 1)).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
		expect(accepted(await read(one.ref.sessionId, made.exportId, 0), "export_part").done).toBe(true);
	});

	test("keeps the newest few exports; an older one is gone and says to export again", async () => {
		t = await LiveRig.create();
		const { ref } = externalSession(t, "many", ["a", "b"]);
		const first = accepted(
			await callPi(t.backend, { kind: "export_session", sessionId: ref.sessionId, format: "jsonl" }),
			"export_session",
		);
		for (let again = 0; again < 4; again++) {
			accepted(
				await callPi(t.backend, { kind: "export_session", sessionId: ref.sessionId, format: "jsonl" }),
				"export_session",
			);
		}
		const gone = await callPi(t.backend, {
			kind: "export_part",
			sessionId: ref.sessionId,
			exportId: first.exportId,
			offset: 0,
		});
		expect(gone).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		if (gone.status === "rejected") expect(gone.rejection.message).toContain("Export the session again");
	});

	test("leaves nothing in the temporary directory once the backend is disposed", async () => {
		const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("broski-pi-transfer-"));
		const before = leftovers().length;
		t = await LiveRig.create();
		const { ref } = externalSession(t, "tidy", ["a", "b"]);
		await readExport(t.backend, ref.sessionId, "jsonl");
		await readExport(t.backend, ref.sessionId, "html");
		expect(leftovers().length).toBe(before + 1);
		await t.dispose();
		t = undefined;
		expect(leftovers().length).toBe(before);
	});
});
