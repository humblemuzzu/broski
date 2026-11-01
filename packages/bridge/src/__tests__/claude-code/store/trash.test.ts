/** D19, OQ5: the OS trash layouts, in a temp tree, never the real one. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeCodeServices } from "../../../backends/claude-code/services";
import { moveToTrash, type TrashTarget, trashTargetOf } from "../../../backends/claude-code/trash";
import { fakeClaudeSdk } from "../helpers/fake-claude-sdk";

let root: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-cc-trash-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 1, 9, 5, 7);

function target(platform: NodeJS.Platform, xdgDataHome?: string): TrashTarget {
	return { platform, home: join(root, "home"), xdgDataHome, now: NOW };
}

function file(name: string, text = name): string {
	mkdirSync(join(root, "src"), { recursive: true });
	const path = join(root, "src", name);
	writeFileSync(path, text);
	return path;
}

describe("moveToTrash", () => {
	test("macOS: ~/.Trash, a second name when the first is taken, directories included", async () => {
		const first = file("a.jsonl");
		mkdirSync(join(root, "src", "a"));
		writeFileSync(join(root, "src", "a", "inner.json"), "{}");
		expect((await moveToTrash([first, join(root, "src", "a")], target("darwin"))).status).toBe("accepted");
		expect(existsSync(first)).toBe(false);
		const again = file("a.jsonl", "second a");
		expect((await moveToTrash([again], target("darwin"))).status).toBe("accepted");
		const trash = join(root, "home", ".Trash");
		expect(readdirSync(trash).sort()).toEqual(["a", "a 2.jsonl", "a.jsonl"]);
		expect(readFileSync(join(trash, "a 2.jsonl"), "utf8")).toBe("second a");
		expect(readFileSync(join(trash, "a", "inner.json"), "utf8")).toBe("{}");
	});

	test("Linux: files/ and info/<name>.trashinfo under $XDG_DATA_HOME, else ~/.local/share", async () => {
		const path = file("s p.jsonl");
		const xdg = join(root, "xdg");
		expect((await moveToTrash([path], target("linux", xdg))).status).toBe("accepted");
		expect(readdirSync(join(xdg, "Trash", "files"))).toEqual(["s p.jsonl"]);
		expect(readFileSync(join(xdg, "Trash", "info", "s p.jsonl.trashinfo"), "utf8")).toBe(
			`[Trash Info]\nPath=${root}/src/s%20p.jsonl\nDeletionDate=2026-11-01T09:05:07\n`,
		);
		const other = file("o.jsonl");
		expect((await moveToTrash([other], target("linux"))).status).toBe("accepted");
		expect(readdirSync(join(root, "home", ".local", "share", "Trash", "files"))).toEqual(["o.jsonl"]);
	});

	test("Linux: a taken name keeps the older file and its info", async () => {
		const xdg = join(root, "xdg");
		mkdirSync(join(xdg, "Trash", "files"), { recursive: true });
		mkdirSync(join(xdg, "Trash", "info"), { recursive: true });
		writeFileSync(join(xdg, "Trash", "files", "t.jsonl"), "older");
		writeFileSync(join(xdg, "Trash", "info", "t.jsonl.trashinfo"), "older info");
		expect((await moveToTrash([file("t.jsonl", "newer")], target("linux", xdg))).status).toBe("accepted");
		expect(readFileSync(join(xdg, "Trash", "files", "t.jsonl"), "utf8")).toBe("older");
		expect(readFileSync(join(xdg, "Trash", "files", "t 2.jsonl"), "utf8")).toBe("newer");
		expect(existsSync(join(xdg, "Trash", "info", "t 2.jsonl.trashinfo"))).toBe(true);
	});

	test("a move that cannot happen leaves the file where it was and says so", async () => {
		const path = file("keep.jsonl");
		const blocked = join(root, "home");
		writeFileSync(blocked, "a file where the home should be");
		const result = await moveToTrash([path], target("darwin"));
		expect(result.status === "rejected" && result.rejection.code).toBe("backend_error");
		expect(existsSync(path)).toBe(true);
		const missing = await moveToTrash([join(root, "nothing.jsonl")], { ...target("darwin"), home: join(root, "h2") });
		expect(missing.status).toBe("rejected");
	});

	test("an unknown HOME and an unsupported platform are refused, never guessed", async () => {
		const path = file("x.jsonl");
		expect((await moveToTrash([path], undefined)).status).toBe("rejected");
		expect((await moveToTrash([path], target("win32"))).status).toBe("rejected");
		expect(existsSync(path)).toBe(true);
	});
});

describe("trashTargetOf", () => {
	const services = (env: Record<string, string>) =>
		createClaudeCodeServices({
			cli: { found: false, reason: "n/a" },
			env,
			stateDir: join(root, "state"),
			clientApp: "broski/test",
			sdk: fakeClaudeSdk(),
			clock: { now: () => NOW.getTime(), after: () => () => undefined },
		}).cliEnv;

	test("comes from the environment the CLI gets, so a test's temp HOME is the only trash it can reach", () => {
		const found = trashTargetOf(services({ HOME: join(root, "home"), XDG_DATA_HOME: join(root, "xdg") }), NOW, "linux");
		expect(found).toMatchObject({ platform: "linux", home: join(root, "home"), xdgDataHome: join(root, "xdg") });
		expect(found?.now.getTime()).toBe(NOW.getTime());
		expect(trashTargetOf(services({}), NOW)).toBeUndefined();
		expect(trashTargetOf(services({ HOME: "relative/home" }), NOW)).toBeUndefined();
		expect(
			trashTargetOf(services({ HOME: join(root, "home"), XDG_DATA_HOME: "relative" }), NOW)?.xdgDataHome,
		).toBeUndefined();
	});
});
