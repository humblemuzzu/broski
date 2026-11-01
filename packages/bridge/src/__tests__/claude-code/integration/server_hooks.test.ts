/**
 * `claudeCode.contract` in the server layer (PLAN D28, D26): what is wired, which hook lands in the user's settings
 * after the listener binds, and that the old protocol's terminal hook stands down. Every file is in a temp home.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keepsOldHook, setClaudeCodeHooks } from "../../../server/claude-code-hooks";
import { createClaudeCodeWiring } from "../../../server/claude-code-wiring";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";

let home: ClaudeHome | undefined;

afterEach(() => {
	home?.cleanup();
	home = undefined;
});

function wiring(contract: boolean, terminalAsks = true) {
	return createClaudeCodeWiring({
		settings: { contract, terminalAsks },
		cli: () => ({ ok: false, reason: "not needed", notes: [] }),
		version: "0.0.0-test",
		log: () => undefined,
	});
}

function listener(claude: ClaudeHome, uninstalled: string[]) {
	const oldFile = join(claude.homeDir, ".claude-old-settings.json");
	return {
		port: 18274,
		token: "a-token",
		certPath: join(claude.root, "server.cert.pem"),
		log: () => undefined,
		configRoot: claude.configDir,
		oldHook: {
			file: oldFile,
			uninstall: async () => {
				uninstalled.push(oldFile);
			},
		},
	};
}

const settingsOf = (claude: ClaudeHome) => JSON.parse(readFileSync(join(claude.configDir, "settings.json"), "utf8"));

describe("the wiring claudeCode.contract switches", () => {
	test("off: no adapter, no receiver, and the old hook is the bridge's to take out at shutdown", () => {
		const off = wiring(false);
		expect(off.backend).toBeUndefined();
		expect(off.receiver).toBeUndefined();
		expect(keepsOldHook(off)).toBe(true);
		expect(keepsOldHook(undefined)).toBe(true);
	});

	test("on: the adapter and the receiver; terminal asks off leaves the receiver out; the old hook is never kept", () => {
		expect(wiring(true).backend).toBeDefined();
		expect(wiring(true).receiver).toBeDefined();
		expect(wiring(true, false).receiver).toBeUndefined();
		expect(keepsOldHook(wiring(true))).toBe(false);
	});
});

describe("the hooks set once the listener is bound, with the contract on", () => {
	test("our PermissionRequest hook over https with the certificate trusted, and a leftover old hook taken out", async () => {
		home = createClaudeHome();
		const uninstalled: string[] = [];
		const bound = listener(home, uninstalled);
		writeFileSync(bound.oldHook.file, JSON.stringify({ hooks: { PreToolUse: ["# broski-permission-proxy"] } }));
		await setClaudeCodeHooks(wiring(true), bound);
		expect(uninstalled).toEqual([bound.oldHook.file]);
		const settings = settingsOf(home);
		expect(settings.hooks.PermissionRequest[0].hooks[0]).toMatchObject({
			type: "http",
			url: "https://127.0.0.1:18274/cc-terminal-hook",
			headers: { Authorization: "Bearer a-token" },
		});
		expect(settings.env).toEqual({ NODE_EXTRA_CA_CERTS: bound.certPath });
		expect("allowedHttpHookUrls" in settings).toBe(false);
		expect(settings.hooks.PreToolUse).toBeUndefined();
	});

	test("terminal asks off removes our hook, and an old file without the marker is not touched", async () => {
		home = createClaudeHome();
		const uninstalled: string[] = [];
		const bound = listener(home, uninstalled);
		writeFileSync(bound.oldHook.file, JSON.stringify({ model: "opus" }));
		await setClaudeCodeHooks(wiring(true), bound);
		await setClaudeCodeHooks(wiring(true, false), bound);
		expect(uninstalled).toEqual([]);
		expect(settingsOf(home)).toEqual({});
	});

	test("a listener without TLS gets an http hook and no certificate setting", async () => {
		home = createClaudeHome();
		const bound = { ...listener(home, []), certPath: undefined };
		await setClaudeCodeHooks(wiring(true), bound);
		const settings = settingsOf(home);
		expect(settings.hooks.PermissionRequest[0].hooks[0].url).toBe("http://127.0.0.1:18274/cc-terminal-hook");
		expect(settings.env).toBeUndefined();
		expect(existsSync(join(home.configDir, "settings.json"))).toBe(true);
	});
});
