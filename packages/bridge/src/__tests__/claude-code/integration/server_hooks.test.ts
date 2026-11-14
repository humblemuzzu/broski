/**
 * Claude Code in the server layer (PLAN D28, D26): what is wired, and which hook lands in the user's settings after
 * the listener binds. Every file is in a temp home.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeClaudeCodeTerminalHook, setClaudeCodeTerminalHook } from "../../../server/claude-code-hooks";
import { createClaudeCodeWiring } from "../../../server/claude-code-wiring";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";

let home: ClaudeHome | undefined;

afterEach(() => {
	home?.cleanup();
	home = undefined;
});

function wiring(terminalAsks: boolean) {
	return createClaudeCodeWiring({
		settings: { terminalAsks },
		cli: () => ({ ok: false, reason: "not needed", notes: [] }),
		version: "0.0.0-test",
		log: () => undefined,
	});
}

function listener(claude: ClaudeHome) {
	return {
		port: 18274,
		token: "a-token",
		certPath: join(claude.root, "server.cert.pem"),
		log: () => undefined,
		configRoot: claude.configDir,
	};
}

const settingsOf = (claude: ClaudeHome) => JSON.parse(readFileSync(join(claude.configDir, "settings.json"), "utf8"));

describe("the wiring", () => {
	test("the adapter always, and the hook's receiver exactly while terminal asks are on", () => {
		expect(wiring(true).backend).toBeDefined();
		expect(wiring(true).receiver).toBeDefined();
		expect(wiring(false).backend).toBeDefined();
		expect(wiring(false).receiver).toBeUndefined();
	});
});

describe("the hook set once the listener is bound", () => {
	test("our PermissionRequest hook over https with the certificate trusted", async () => {
		home = createClaudeHome();
		await setClaudeCodeTerminalHook(true, listener(home));
		const settings = settingsOf(home);
		expect(settings.hooks.PermissionRequest[0].hooks[0]).toMatchObject({
			type: "http",
			url: "https://127.0.0.1:18274/cc-terminal-hook",
			headers: { Authorization: "Bearer a-token" },
		});
		expect(settings.env).toEqual({ NODE_EXTRA_CA_CERTS: listener(home).certPath });
		expect("allowedHttpHookUrls" in settings).toBe(false);
	});

	test("terminal asks off removes our hook", async () => {
		home = createClaudeHome();
		await setClaudeCodeTerminalHook(true, listener(home));
		expect(JSON.stringify(settingsOf(home))).toContain("cc-terminal-hook");
		await setClaudeCodeTerminalHook(false, listener(home));
		expect(settingsOf(home)).toEqual({});
	});

	test("broski uninstall takes our hook and our certificate setting out, and leaves the user's keys", async () => {
		home = createClaudeHome();
		const claude = home;
		const settingsPath = join(claude.configDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ model: "opus" }));
		const place = {
			certPath: join(claude.root, "server.cert.pem"),
			log: () => undefined,
			configRoot: claude.configDir,
		};
		await setClaudeCodeTerminalHook(true, { ...place, port: 18274, token: "a-token" });
		expect(readFileSync(settingsPath, "utf8")).toContain("cc-terminal-hook");
		await removeClaudeCodeTerminalHook(place);
		expect(settingsOf(claude)).toEqual({ model: "opus" });
	});

	test("a listener without TLS gets an http hook and no certificate setting", async () => {
		home = createClaudeHome();
		await setClaudeCodeTerminalHook(true, { ...listener(home), certPath: undefined });
		const settings = settingsOf(home);
		expect(settings.hooks.PermissionRequest[0].hooks[0].url).toBe("http://127.0.0.1:18274/cc-terminal-hook");
		expect(settings.env).toBeUndefined();
		expect(existsSync(join(home.configDir, "settings.json"))).toBe(true);
	});
});
