/**
 * Files over the contract: the core with the real workspace host and the production path policy, on a real
 * directory tree in the temp directory.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_FILE_READ_BYTES } from "../contract";
import type { CoreRig, TestClient } from "./helpers/core-rig";
import { ensureNativePtyLibrary } from "./helpers/native-pty-library";
import { accepted, rejectionCode, startWorkspaceRig, tempDirectory } from "./helpers/workspace-rig";

const root = tempDirectory("broski-files-");
const binary = Uint8Array.from({ length: 256 }, (_, index) => index);
const accented = "é".repeat(1000);
const big = "0123456789abcdef".repeat((MAX_FILE_READ_BYTES + 1_048_576) / 16);
let rig: CoreRig;
let phone: TestClient;

beforeAll(async () => {
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, "many"));
	writeFileSync(join(root, "a.txt"), "hello\n");
	writeFileSync(join(root, "B.md"), "# B\n");
	writeFileSync(join(root, ".hidden"), "");
	writeFileSync(join(root, "c.bin"), binary);
	writeFileSync(join(root, "accented.txt"), accented);
	writeFileSync(join(root, "big.txt"), big);
	writeFileSync(join(root, "src", "main.ts"), "export {};\n");
	for (let index = 0; index < 250; index += 1)
		writeFileSync(join(root, "many", `f${String(index).padStart(3, "0")}`), "");
	symlinkSync("/etc", join(root, "escape"));
	symlinkSync("src", join(root, "inside"));
	ensureNativePtyLibrary();
	rig = await startWorkspaceRig();
	phone = await rig.client("phone");
});

afterAll(async () => {
	await rig.core.dispose();
	rmSync(root, { recursive: true, force: true });
});

const list = async (path: string, extra: { cursor?: string; limit?: number; hidden?: boolean } = {}) =>
	(await phone.ok("fs.list", { path, ...extra })).result;
const read = async (path: string, extra: { offset?: number; length?: number } = {}) =>
	(await phone.ok("fs.read", { path, ...extra })).result;

describe("listing a directory", () => {
	test("puts directories first, then names ignoring case, shows links as links and hidden names only when asked", async () => {
		const listed = accepted(await list(root));
		expect(listed.path).toBe(root);
		expect(listed.entries.map((entry) => [entry.name, entry.kind])).toEqual([
			["many", "dir"],
			["src", "dir"],
			["a.txt", "file"],
			["accented.txt", "file"],
			["B.md", "file"],
			["big.txt", "file"],
			["c.bin", "file"],
			["escape", "symlink"],
			["inside", "symlink"],
		]);
		expect(listed.entries.find((entry) => entry.name === "a.txt")?.size).toBe(6);
		expect(listed.entries.find((entry) => entry.name === "src")?.size).toBeUndefined();
		expect(listed.entries.every((entry) => typeof entry.modifiedAt === "number")).toBe(true);
		expect(listed.nextCursor).toBeUndefined();
		const withHidden = accepted(await list(root, { hidden: true }));
		expect(withHidden.entries.map((entry) => entry.name)).toContain(".hidden");
	});

	test("pages by cursor, and the pages make the whole listing even when a file appears between them", async () => {
		const first = accepted(await list(join(root, "many"), { limit: 100 }));
		expect(first.entries).toHaveLength(100);
		writeFileSync(join(root, "many", "f000a"), "");
		const second = accepted(await list(join(root, "many"), { limit: 100, cursor: first.nextCursor }));
		const third = accepted(await list(join(root, "many"), { limit: 100, cursor: second.nextCursor }));
		expect(third.nextCursor).toBeUndefined();
		const names = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.name);
		const expected = Array.from({ length: 250 }, (_, index) => `f${String(index).padStart(3, "0")}`);
		expect(names).toEqual(expected);
		expect(rejectionCode(await list(join(root, "many"), { cursor: "not a cursor" }))).toBe("invalid_input");
	});

	test("follows a link that stays inside the served folders, and answers its canonical path", async () => {
		const listed = accepted(await list(join(root, "inside")));
		expect(listed.path).toBe(join(root, "src"));
		expect(listed.entries.map((entry) => entry.name)).toEqual(["main.ts"]);
	});
});

describe("reading a file", () => {
	test("reads UTF-8 text as text and anything else as base64, byte for byte", async () => {
		expect(accepted(await read(join(root, "a.txt")))).toMatchObject({
			encoding: "utf8",
			content: "hello\n",
			offset: 0,
			length: 6,
			size: 6,
			truncated: false,
		});
		const bytes = accepted(await read(join(root, "c.bin")));
		expect(bytes.encoding).toBe("base64");
		expect(Buffer.from(bytes.content, "base64")).toEqual(Buffer.from(binary));
	});

	test("reads a large file in parts, each ending on a whole character, that make the file again", async () => {
		const parts: string[] = [];
		let offset = 0;
		for (;;) {
			const part = accepted(await read(join(root, "accented.txt"), { offset, length: 333 }));
			expect(part.encoding).toBe("utf8");
			parts.push(part.content);
			offset += part.length;
			if (!part.truncated) break;
		}
		expect(parts.join("")).toBe(accented);
		const first = accepted(await read(join(root, "big.txt")));
		expect(first).toMatchObject({ length: MAX_FILE_READ_BYTES, size: big.length, truncated: true });
		const rest = accepted(await read(join(root, "big.txt"), { offset: first.length }));
		expect(rest.truncated).toBe(false);
		expect(first.content + rest.content).toBe(big);
	});

	test("refuses a directory, and says what does not exist", async () => {
		expect(rejectionCode(await read(join(root, "src")))).toBe("invalid_input");
		expect(rejectionCode(await read(join(root, "nope.txt")))).toBe("not_found");
		expect(rejectionCode(await list(join(root, "a.txt")))).toBe("invalid_input");
	});
});

describe("the path policy", () => {
	test("refuses what lies outside the served folders, named directly or reached through a link", async () => {
		expect(rejectionCode(await read("/etc/hosts"))).toBe("forbidden");
		expect(rejectionCode(await list("/"))).toBe("forbidden");
		expect(rejectionCode(await list(join(root, "escape")))).toBe("forbidden");
		expect(rejectionCode(await read(join(root, "escape", "hosts")))).toBe("forbidden");
		expect(rejectionCode(await read(join(root, "src", "..", "..", "..", "etc", "hosts")))).toBe("forbidden");
		expect(rejectionCode(await read(`${root}/a.txt\u0001`))).toBe("invalid_input");
	});
});

describe("searching", () => {
	test("finds files and directories by name under a root, and refuses a root that is not a served directory", async () => {
		const found = accepted((await phone.ok("fs.search", { root, query: "main.ts" })).result);
		expect(found.root).toBe(root);
		expect(found.matches[0]).toEqual({ path: "src/main.ts", kind: "file" });
		const dirs = accepted((await phone.ok("fs.search", { root, query: "many" })).result);
		expect(dirs.matches).toContainEqual({ path: "many", kind: "dir" });
		expect(rejectionCode((await phone.ok("fs.search", { root: "/etc", query: "hosts" })).result)).toBe("forbidden");
		const notADirectory = await phone.ok("fs.search", { root: join(root, "a.txt"), query: "a" });
		expect(rejectionCode(notADirectory.result)).toBe("invalid_input");
	});
});

describe("what the workspace offers", () => {
	test("names the served folders canonical, each once, and says git and terminals are there", async () => {
		const info = accepted((await phone.ok("workspace.info", {})).result);
		expect(info.roots).toContain(realpathSync(tmpdir()));
		expect(new Set(info.roots).size).toBe(info.roots.length);
		expect(info).toMatchObject({ git: true, terminal: true });
	});
});
