/** Adapter README D27: the macOS trash, in a temp tree, never the real one. */

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

function target(platform: NodeJS.Platform): TrashTarget {
	return { platform, home: join(root, "home") };
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

	test("macOS refusing the move (a service without Full Disk Access) is a rejection that says why; nothing is copied", async () => {
		const path = file("settings.json", "{}");
		const refusing = async () => {
			throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
		};
		const result = await moveToTrash([path], { ...target("darwin"), rename: refusing });
		expect(result.status === "rejected" && result.rejection.code).toBe("backend_error");
		expect(result.status === "rejected" && result.rejection.message).toContain("Full Disk Access");
		expect(readFileSync(path, "utf8")).toBe("{}");
		expect(readdirSync(join(root, "home", ".Trash"))).toEqual([]);
	});

	test("an unknown HOME and an unsupported platform are refused, never guessed", async () => {
		const path = file("x.jsonl");
		expect((await moveToTrash([path], undefined)).status).toBe("rejected");
		expect((await moveToTrash([path], target("freebsd"))).status).toBe("rejected");
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
			clock: { now: () => Date.now(), after: () => () => undefined },
		}).cliEnv;

	test("comes from the environment the CLI gets, so a test's temp HOME is the only trash it can reach", () => {
		const found = trashTargetOf(services({ HOME: join(root, "home") }), "darwin");
		expect(found).toEqual({ platform: "darwin", home: join(root, "home") });
		expect(trashTargetOf(services({}))).toBeUndefined();
		expect(trashTargetOf(services({ HOME: "relative/home" }))).toBeUndefined();
	});
});
