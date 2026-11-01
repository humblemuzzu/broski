/** The old protocol's PreToolUse hook installer edits the user's Claude settings strictly; every file is in a temp dir. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_MARKER, installCcHook, uninstallCcHook } from "../handlers/cc_hook_installer";

let root: string;
let settingsPath: string;
let said: string[];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "broski-old-hook-"));
	settingsPath = join(root, "settings.json");
	said = [];
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const install = () =>
	installCcHook({ port: 18274, token: "t0ken", scheme: "https", settingsPath, log: (line) => said.push(line) });
const uninstall = () => uninstallCcHook((line) => said.push(line), settingsPath);

const USER = {
	model: "opus",
	permissions: { allow: ["Bash(ls:*)"] },
	hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo post" }] }] },
};

describe("the old hook installer never loses the user's settings", () => {
	const refused: [string, string][] = [
		["a comment", '{ // my notes\n "model": "opus", "permissions": {"allow": []}\n}'],
		["a trailing comma", '{"model": "opus", "permissions": {"allow": []},}'],
		["truncated JSON", '{"model": "op'],
		["hooks that are not an object", '{"model": "opus", "hooks": []}'],
		["a PreToolUse that is not a list", '{"hooks": {"PreToolUse": {}}}'],
	];
	for (const [name, content] of refused) {
		test(`${name}: install and uninstall leave the file byte for byte, and say why`, async () => {
			writeFileSync(settingsPath, content);
			await install();
			await uninstall();
			expect(readFileSync(settingsPath, "utf8")).toBe(content);
			expect(readdirSync(root)).toEqual(["settings.json"]);
			expect(said.filter((line) => line.includes("not changed"))).toHaveLength(2);
		});
	}

	test("a valid file keeps every key, its indentation and its mode; uninstall gives back what was there", async () => {
		const original = `${JSON.stringify(USER, null, "\t")}\n`;
		writeFileSync(settingsPath, original, { mode: 0o640 });
		await install();
		const installed = JSON.parse(readFileSync(settingsPath, "utf8"));
		expect(installed.model).toBe("opus");
		expect(installed.permissions).toEqual(USER.permissions);
		expect(installed.hooks.PostToolUse).toEqual(USER.hooks.PostToolUse);
		expect(installed.hooks.PreToolUse[0].hooks[0].command).toContain(HOOK_MARKER);
		expect(readFileSync(settingsPath, "utf8")).toContain('\n\t"model"');
		expect(statSync(settingsPath).mode & 0o777).toBe(0o640);
		await uninstall();
		expect(readFileSync(settingsPath, "utf8")).toBe(original);
	});

	test("a missing file is created private; uninstall with no file creates nothing", async () => {
		await uninstall();
		expect(existsSync(settingsPath)).toBe(false);
		await install();
		expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
	});
});
