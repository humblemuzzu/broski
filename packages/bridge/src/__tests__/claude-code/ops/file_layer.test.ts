/** The file layer under `config_file`: containment, revisions, atomic writes, the Trash. */

import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containedPath } from "../../../backends/claude-code/ops/contained-path";
import { ABSENT_REVISION, readFileState, revisionOfText } from "../../../backends/claude-code/ops/file-state";
import { trashIfUnchanged, writeIfUnchanged } from "../../../backends/claude-code/ops/file-write";
import { jsonProblem } from "../../../backends/claude-code/ops/json-check";
import { trashTargetOf } from "../../../backends/claude-code/trash";

const roots: string[] = [];

function temp(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-file-layer-")));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("containedPath", () => {
	test("accepts a file in the base, a file not made yet, and one below a directory not made yet", async () => {
		const base = temp();
		writeFileSync(join(base, "a.json"), "{}");
		expect(await containedPath(base, join(base, "a.json"))).toEqual({ real: join(base, "a.json") });
		expect(await containedPath(base, join(base, "new.json"))).toEqual({ real: join(base, "new.json") });
		expect(await containedPath(base, join(base, "x", "y", "z.md"))).toEqual({ real: join(base, "x", "y", "z.md") });
	});

	test("refuses traversal and a link that leaves the base, but follows a link that stays", async () => {
		const base = temp();
		const outside = temp();
		writeFileSync(join(outside, "secret"), "s");
		mkdirSync(join(base, "real"));
		writeFileSync(join(base, "real", "f.md"), "x");
		symlinkSync(join(outside, "secret"), join(base, "leak.md"));
		symlinkSync(outside, join(base, "dir"));
		symlinkSync(join(base, "real", "f.md"), join(base, "inside.md"));
		symlinkSync(join(base, "gone"), join(base, "dangling.md"));
		expect("problem" in (await containedPath(base, join(base, "..", "x")))).toBe(true);
		expect("problem" in (await containedPath(base, join(base, "leak.md")))).toBe(true);
		expect("problem" in (await containedPath(base, join(base, "dir", "secret")))).toBe(true);
		expect("problem" in (await containedPath(base, join(base, "dangling.md")))).toBe(true);
		expect(await containedPath(base, join(base, "inside.md"))).toEqual({ real: join(base, "real", "f.md") });
	});

	test("compares real paths, so a base that is itself a link works", async () => {
		const real = temp();
		const holder = temp();
		const alias = join(holder, "alias");
		symlinkSync(real, alias);
		writeFileSync(join(real, "settings.json"), "{}");
		expect(await containedPath(alias, join(alias, "settings.json"))).toEqual({ real: join(real, "settings.json") });
	});
});

describe("readFileState", () => {
	test("an absent file has the absent revision; a present one is hashed by its bytes", async () => {
		const base = temp();
		expect(await readFileState(join(base, "none"))).toMatchObject({ exists: false, revision: ABSENT_REVISION });
		writeFileSync(join(base, "f"), "héllo");
		const state = await readFileState(join(base, "f"));
		expect(state).toMatchObject({ exists: true, text: "héllo", truncated: false, faithful: true });
		expect(state.revision).toBe(revisionOfText("héllo"));
	});

	test("a file that is not UTF-8 is not faithful and a directory is not a file", async () => {
		const base = temp();
		writeFileSync(join(base, "bin"), Buffer.from([0xff, 0xfe, 0x41]));
		mkdirSync(join(base, "d"));
		expect((await readFileState(join(base, "bin"))).faithful).toBe(false);
		expect(await readFileState(join(base, "d"))).toMatchObject({ exists: true, faithful: false });
	});

	test("a named pipe is reported, not opened (opening one would wait for a writer for ever)", async () => {
		const base = temp();
		const made = Bun.spawnSync(["mkfifo", join(base, "pipe")]);
		if (made.exitCode !== 0) return;
		expect(await readFileState(join(base, "pipe"))).toMatchObject({ exists: true, faithful: false });
	});

	test("a file past the contract's text bound is truncated and never faithful", async () => {
		const base = temp();
		writeFileSync(join(base, "big"), "a".repeat(1_048_576 + 5));
		const state = await readFileState(join(base, "big"));
		expect(state).toMatchObject({ truncated: true, faithful: false });
		expect(state.text.length).toBe(1_048_576);
	});

	test("keeps a byte order mark in the text, so writing it back loses nothing", async () => {
		const base = temp();
		writeFileSync(join(base, "bom"), "\uFEFF{}");
		expect((await readFileState(join(base, "bom"))).text).toBe("\uFEFF{}");
	});
});

describe("writeIfUnchanged", () => {
	test("creates a file only while it does not exist, with directories as needed", async () => {
		const base = temp();
		const target = join(base, "a", "b", "f.md");
		expect(await writeIfUnchanged(target, "one", ABSENT_REVISION)).toEqual({ ok: true });
		expect(readFileSync(target, "utf8")).toBe("one");
		expect(await writeIfUnchanged(target, "two", ABSENT_REVISION)).toMatchObject({ ok: false, reason: "stale" });
		expect(readFileSync(target, "utf8")).toBe("one");
	});

	test("replaces only at the revision read, and leaves no temp file behind", async () => {
		const base = temp();
		const target = join(base, "settings.json");
		writeFileSync(target, '{"a":1}');
		const revision = revisionOfText('{"a":1}');
		expect(await writeIfUnchanged(target, '{"a":2}', "sha256-other")).toMatchObject({ ok: false, reason: "stale" });
		expect(await writeIfUnchanged(target, '{"a":2}', revision)).toEqual({ ok: true });
		expect(readFileSync(target, "utf8")).toBe('{"a":2}');
		expect(await writeIfUnchanged(target, '{"a":3}', revision)).toMatchObject({ ok: false, reason: "stale" });
		expect(readdirSync(base)).toEqual(["settings.json"]);
	});

	test("keeps the mode of the file it replaces", async () => {
		const base = temp();
		const target = join(base, "private.json");
		writeFileSync(target, "{}");
		chmodSync(target, 0o600);
		await writeIfUnchanged(target, '{"k":1}', revisionOfText("{}"));
		expect(statSync(target).mode & 0o777).toBe(0o600);
	});

	test("writes through a link that stays inside, so the link survives", async () => {
		const base = temp();
		mkdirSync(join(base, "real"));
		writeFileSync(join(base, "real", "f.md"), "old");
		symlinkSync(join(base, "real", "f.md"), join(base, "link.md"));
		const contained = await containedPath(base, join(base, "link.md"));
		if (!("real" in contained)) throw new Error("not contained");
		await writeIfUnchanged(contained.real, "new", revisionOfText("old"));
		expect(lstatSync(join(base, "link.md")).isSymbolicLink()).toBe(true);
		expect(readFileSync(join(base, "link.md"), "utf8")).toBe("new");
	});

	test("two concurrent writes at the same revision: one lands, the other is stale", async () => {
		const base = temp();
		const target = join(base, "f.md");
		writeFileSync(target, "start");
		const revision = revisionOfText("start");
		const results = await Promise.all([
			writeIfUnchanged(target, "first", revision),
			writeIfUnchanged(target, "second", revision),
		]);
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(readFileSync(target, "utf8")).toBe(results[0]?.ok ? "first" : "second");
	});

	test("refuses to rewrite a file whose text is not a faithful copy", async () => {
		const base = temp();
		const target = join(base, "bin");
		writeFileSync(target, Buffer.from([0xff, 0xfe]));
		const state = await readFileState(target);
		expect(await writeIfUnchanged(target, "x", state.revision)).toMatchObject({ ok: false, reason: "failed" });
		expect([...readFileSync(target)]).toEqual([0xff, 0xfe]);
	});
});

describe("trashIfUnchanged", () => {
	const NOW = new Date(2026, 10, 1, 12, 0, 0);

	for (const platform of ["darwin", "linux"] as const) {
		test(`moves the file to the ${platform} trash under the given HOME, only at its revision`, async () => {
			const root = temp();
			const home = join(root, "home");
			const trash = trashTargetOf({ HOME: home }, NOW, platform);
			const target = join(root, "agent.md");
			writeFileSync(target, "x");
			expect(await trashIfUnchanged(target, "sha256-other", trash)).toMatchObject({ ok: false, reason: "stale" });
			expect(existsSync(target)).toBe(true);
			expect(await trashIfUnchanged(target, revisionOfText("x"), trash)).toEqual({ ok: true });
			expect(existsSync(target)).toBe(false);
			const files = platform === "darwin" ? join(home, ".Trash") : join(home, ".local", "share", "Trash", "files");
			expect(readdirSync(files)).toEqual(["agent.md"]);
		});
	}

	test("leaves the file when the trash is unknown", async () => {
		const root = temp();
		const target = join(root, "agent.md");
		writeFileSync(target, "x");
		const outcome = await trashIfUnchanged(target, revisionOfText("x"), trashTargetOf({}, NOW));
		expect(outcome).toMatchObject({ ok: false, reason: "failed" });
		expect(existsSync(target)).toBe(true);
	});
});

describe("jsonProblem", () => {
	test("accepts an object, with or without a byte order mark, and names what is wrong otherwise", () => {
		expect(jsonProblem('{"a":1}')).toBeUndefined();
		expect(jsonProblem('\uFEFF{"a":1}')).toBeUndefined();
		expect(jsonProblem('{"a":1,}')).toBeString();
		expect(jsonProblem("// c\n{}")).toBeString();
		expect(jsonProblem("[]")).toBe("the top level must be a JSON object");
		expect(jsonProblem("")).toBeString();
		expect(jsonProblem("null")).toBe("the top level must be a JSON object");
	});
});
