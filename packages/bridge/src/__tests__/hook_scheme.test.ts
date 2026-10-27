/**
 * The permission hooks are shell commands in the user's own config that call the bridge back, so
 * they have to name the scheme the loopback listener actually serves: with `BROSKI_TLS=0` an
 * `https://` URL to a plain listener fails silently and approvals stop reaching the phone.
 *
 * `os.homedir()` is cached at process start, so each install runs in a child whose HOME is a temp
 * directory rather than in this process.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHILD_SCRIPT = resolve(import.meta.dir, "safety", "hook-scheme-child.ts");
const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..");
const PORT = 18290;
const TOKEN = "hook-scheme-token";

const homes: string[] = [];

function tempHome(): string {
	const home = mkdtempSync(join(tmpdir(), "broski-hook-scheme-"));
	homes.push(home);
	return home;
}

afterAll(() => {
	for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function install(home: string, scheme: "http" | "https"): void {
	const result = spawnSync("bun", [CHILD_SCRIPT, scheme, String(PORT)], {
		cwd: BRIDGE_ROOT,
		encoding: "utf-8",
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
	});
	if (result.status !== 0) throw new Error(`install failed: ${result.stderr}`);
}

function hookCommands(settings: Record<string, unknown>, event: string): string[] {
	const hooks = settings.hooks as Record<string, unknown> | undefined;
	const list = hooks?.[event];
	if (!Array.isArray(list)) return [];
	return list.flatMap((matcher) => {
		const hooks = (matcher as { hooks?: Array<{ command?: string }> }).hooks;
		return Array.isArray(hooks)
			? hooks.flatMap((hook) => (typeof hook.command === "string" ? [hook.command] : []))
			: [];
	});
}

function ccCommands(home: string): string[] {
	const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8")) as Record<string, unknown>;
	return hookCommands(settings, "PreToolUse");
}

function cxCommands(home: string): string[] {
	const settings = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf-8")) as Record<string, unknown>;
	return hookCommands(settings, "PreToolUse");
}

describe("the permission hooks", () => {
	test("call the listener over http when the listener serves http", () => {
		const home = tempHome();
		install(home, "http");
		for (const command of [...ccCommands(home), ...cxCommands(home)]) {
			expect(command).toContain(`http://127.0.0.1:${PORT}/`);
			expect(command).not.toContain("https://127.0.0.1");
			expect(command).toContain(TOKEN);
		}
	});

	test("are rewritten to https when the listener starts serving tls", () => {
		const home = tempHome();
		install(home, "http");
		install(home, "https");
		const cc = ccCommands(home);
		const cx = cxCommands(home);
		expect(cc).toHaveLength(1);
		expect(cx).toHaveLength(1);
		expect(cc[0]).toContain(`https://127.0.0.1:${PORT}/cc-hook`);
		expect(cx[0]).toContain(`https://127.0.0.1:${PORT}/cx-hook`);
	});

	test("a scheme change rewrites in place rather than adding a second hook", () => {
		const home = tempHome();
		install(home, "https");
		install(home, "http");
		expect(ccCommands(home)).toHaveLength(1);
		expect(cxCommands(home)).toHaveLength(1);
		expect(ccCommands(home)[0]).toContain(`http://127.0.0.1:${PORT}/cc-hook`);
	});
});
