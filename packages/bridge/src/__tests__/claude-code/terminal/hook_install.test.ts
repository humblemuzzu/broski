import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installTerminalHook,
	MAX_SETTINGS_BYTES,
	removeTerminalHook,
} from "../../../backends/claude-code/terminal/hook-install";
import { type HookSpec, TERMINAL_HOOK_TIMEOUT_SECONDS } from "../../../backends/claude-code/terminal/hook-settings";

let root: string;
let settingsPath: string;

const SPEC: HookSpec = {
	url: "https://127.0.0.1:18274/cc-terminal-hook",
	token: "secret-token-1234",
	timeoutSeconds: TERMINAL_HOOK_TIMEOUT_SECONDS,
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "broski-hook-"));
	settingsPath = join(root, "settings.json");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const read = () => JSON.parse(readFileSync(settingsPath, "utf8"));
const write = (value: unknown) => writeFileSync(settingsPath, JSON.stringify(value, null, 2));

const USER_SETTINGS = {
	$schema: "https://json.schemastore.org/claude-code-settings.json",
	model: "opus",
	permissions: { allow: ["Bash(ls:*)"], deny: ["Read(.env)"] },
	hooks: {
		PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
		PermissionRequest: [{ matcher: "Write", hooks: [{ type: "command", command: "echo mine" }] }],
	},
	allowedHttpHookUrls: ["https://hooks.example.com/*"],
	env: { FOO: "bar" },
	statusLine: { type: "command", command: "echo hi" },
};

describe("installing the terminal ask hook", () => {
	test("a fresh config dir gets a private settings file with the hook and the token in a header, and no URL list", async () => {
		const dir = join(root, "fresh", ".claude");
		const result = await installTerminalHook(dir, SPEC);
		expect(result).toMatchObject({ status: "installed" });
		const file = join(dir, "settings.json");
		expect(statSync(file).mode & 0o777).toBe(0o600);
		const settings = JSON.parse(readFileSync(file, "utf8"));
		expect(settings).toEqual({
			hooks: {
				PermissionRequest: [
					{
						hooks: [
							{
								type: "http",
								url: SPEC.url,
								timeout: TERMINAL_HOOK_TIMEOUT_SECONDS,
								headers: { Authorization: "Bearer secret-token-1234" },
								statusMessage: expect.any(String),
							},
						],
					},
				],
			},
		});
		expect(SPEC.url).not.toContain(SPEC.token);
		expect(readFileSync(file, "utf8")).not.toContain("command");
	});

	test("every other key and the user's own hooks and URLs survive, and the file keeps its indentation", async () => {
		writeFileSync(settingsPath, `${JSON.stringify(USER_SETTINGS, null, "\t")}\n`);
		await installTerminalHook(root, SPEC);
		const settings = read();
		const { hooks, allowedHttpHookUrls, ...rest } = settings;
		const { hooks: _h, allowedHttpHookUrls: _a, ...expectedRest } = USER_SETTINGS;
		expect(rest).toEqual(expectedRest);
		expect(hooks.PreToolUse).toEqual(USER_SETTINGS.hooks.PreToolUse);
		expect(hooks.PermissionRequest).toHaveLength(2);
		expect(hooks.PermissionRequest[0]).toEqual(USER_SETTINGS.hooks.PermissionRequest[0]);
		expect(allowedHttpHookUrls).toEqual(["https://hooks.example.com/*", SPEC.url]);
		expect(Object.keys(settings).slice(0, 4)).toEqual(["$schema", "model", "permissions", "hooks"]);
		expect(readFileSync(settingsPath, "utf8")).toStartWith('{\n\t"$schema"');
	});

	test("installing twice changes nothing the second time, byte for byte", async () => {
		write(USER_SETTINGS);
		await installTerminalHook(root, SPEC);
		const once = readFileSync(settingsPath, "utf8");
		expect(await installTerminalHook(root, SPEC)).toMatchObject({ status: "unchanged" });
		expect(readFileSync(settingsPath, "utf8")).toBe(once);
	});

	test("a new port and token replace the old entry and the old pinned URL, nothing is added twice", async () => {
		write(USER_SETTINGS);
		await installTerminalHook(root, SPEC);
		const next = { ...SPEC, url: "https://127.0.0.1:19999/cc-terminal-hook", token: "another" };
		expect(await installTerminalHook(root, next)).toMatchObject({ status: "installed" });
		const settings = read();
		expect(settings.allowedHttpHookUrls).toEqual(["https://hooks.example.com/*", next.url]);
		const ours = settings.hooks.PermissionRequest.flatMap((group: { hooks: { type: string }[] }) =>
			group.hooks.filter((hook) => hook.type === "http"),
		);
		expect(ours).toHaveLength(1);
		expect(ours[0]).toMatchObject({ url: next.url, headers: { Authorization: "Bearer another" } });
		expect(JSON.stringify(settings)).not.toContain("secret-token-1234");
	});

	test("a certificate file is pointed at in env, and removing the hook takes it out again", async () => {
		write(USER_SETTINGS);
		const ca = "/home/me/.broski/tls/server.cert.pem";
		await installTerminalHook(root, { ...SPEC, caCertPath: ca });
		expect(read().env).toEqual({ FOO: "bar", NODE_EXTRA_CA_CERTS: ca });
		await removeTerminalHook(root, ca);
		expect(read()).toEqual(USER_SETTINGS);
	});

	test("a certificate setting the user already has for another file refuses the install and writes nothing", async () => {
		write({ env: { NODE_EXTRA_CA_CERTS: "/corp/ca.pem" } });
		const before = readFileSync(settingsPath, "utf8");
		const result = await installTerminalHook(root, { ...SPEC, caCertPath: "/home/me/cert.pem" });
		expect(result).toMatchObject({ status: "refused", reason: expect.stringContaining("NODE_EXTRA_CA_CERTS") });
		expect(readFileSync(settingsPath, "utf8")).toBe(before);
	});

	test("a symlinked settings file is edited where it points and stays a link", async () => {
		const elsewhere = join(root, "dotfiles");
		mkdirSync(elsewhere);
		writeFileSync(join(elsewhere, "settings.json"), JSON.stringify({ model: "opus" }));
		symlinkSync(join(elsewhere, "settings.json"), settingsPath);
		await installTerminalHook(root, SPEC);
		expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
		expect(JSON.parse(readFileSync(join(elsewhere, "settings.json"), "utf8")).model).toBe("opus");
		expect(JSON.parse(readFileSync(join(elsewhere, "settings.json"), "utf8")).hooks.PermissionRequest).toHaveLength(1);
		expect(readdirSync(elsewhere)).toEqual(["settings.json"]);
	});

	test("an existing file keeps its mode, and no temporary file is left behind", async () => {
		write(USER_SETTINGS);
		Bun.spawnSync(["chmod", "640", settingsPath]);
		await installTerminalHook(root, SPEC);
		expect(statSync(settingsPath).mode & 0o777).toBe(0o640);
		expect(readdirSync(root)).toEqual(["settings.json"]);
	});

	test("two installs at once leave one valid file with one hook of ours", async () => {
		write(USER_SETTINGS);
		const a = { ...SPEC, url: "https://127.0.0.1:20001/cc-terminal-hook" };
		const b = { ...SPEC, url: "https://127.0.0.1:20002/cc-terminal-hook" };
		const results = await Promise.all([installTerminalHook(root, a), installTerminalHook(root, b)]);
		for (const result of results) expect(["installed", "unchanged", "refused"]).toContain(result.status);
		const settings = read();
		const ours = settings.hooks.PermissionRequest.flatMap((group: { hooks: { type: string }[] }) =>
			group.hooks.filter((hook) => hook.type === "http"),
		);
		expect(ours).toHaveLength(1);
		expect(settings.allowedHttpHookUrls).toHaveLength(2);
		expect(readdirSync(root)).toEqual(["settings.json"]);
	});

	test("an empty file is filled", async () => {
		writeFileSync(settingsPath, "  \n");
		expect(await installTerminalHook(root, SPEC)).toMatchObject({ status: "installed" });
		expect(read().hooks.PermissionRequest).toHaveLength(1);
	});

	test("a user with no URL list gets none, so their other HTTP hooks keep running", async () => {
		const theirs = { hooks: { PostToolUse: [{ hooks: [{ type: "http", url: "https://hooks.example.com/x" }] }] } };
		write(theirs);
		expect(await installTerminalHook(root, SPEC)).toMatchObject({ status: "installed" });
		const settings = read();
		expect("allowedHttpHookUrls" in settings).toBe(false);
		expect(settings.hooks.PostToolUse).toEqual(theirs.hooks.PostToolUse);
		await removeTerminalHook(root);
		expect(read()).toEqual(theirs);
	});

	test("a user who keeps a URL list gets ours appended, and removal leaves theirs as it was", async () => {
		write({ allowedHttpHookUrls: ["https://hooks.example.com/*"] });
		await installTerminalHook(root, SPEC);
		expect(read().allowedHttpHookUrls).toEqual(["https://hooks.example.com/*", SPEC.url]);
		await removeTerminalHook(root);
		expect(read()).toEqual({ allowedHttpHookUrls: ["https://hooks.example.com/*"] });
	});

	test("a list an older install created with only our URL goes, so nothing is blocked any more", async () => {
		write({ allowedHttpHookUrls: ["https://127.0.0.1:1234/cc-terminal-hook"] });
		await installTerminalHook(root, SPEC);
		expect("allowedHttpHookUrls" in read()).toBe(false);
	});

	test("an empty URL list (no HTTP hook may run) refuses the install and writes nothing", async () => {
		write({ allowedHttpHookUrls: [] });
		const before = readFileSync(settingsPath, "utf8");
		expect(await installTerminalHook(root, SPEC)).toMatchObject({ status: "refused" });
		expect(readFileSync(settingsPath, "utf8")).toBe(before);
	});
});

describe("refusing a settings file it cannot edit safely", () => {
	const REFUSED: [string, string][] = [
		["a trailing comma", '{"model": "opus",}'],
		["a comment", '{"model": "opus" // x\n}'],
		["truncated JSON", '{"model": "op'],
		["a key written twice", '{"model": "opus", "model": "sonnet"}'],
		["a number a double cannot hold", '{"cleanupPeriodDays": 1e400}'],
		["an array", "[1, 2]"],
		["a string", '"settings"'],
		["null", "null"],
		["hooks that are not an object", '{"hooks": []}'],
		["a hook event that is not a list", '{"hooks": {"PermissionRequest": {}}}'],
		["allowedHttpHookUrls that is not a list", '{"allowedHttpHookUrls": "https://x"}'],
		["allowedHttpHookUrls with a non-string", '{"allowedHttpHookUrls": [1]}'],
	];
	for (const [name, content] of REFUSED) {
		test(`${name}: refused, and the file is byte-for-byte what it was`, async () => {
			writeFileSync(settingsPath, content);
			const installed = await installTerminalHook(root, SPEC);
			expect(installed.status).toBe("refused");
			const removed = await removeTerminalHook(root);
			expect(removed.status).toBe("refused");
			expect(readFileSync(settingsPath, "utf8")).toBe(content);
			expect(readdirSync(root)).toEqual(["settings.json"]);
		});
	}

	test("an unreadable location is refused, not thrown", async () => {
		writeFileSync(join(root, "blocker"), "x");
		const result = await installTerminalHook(join(root, "blocker", "nested"), SPEC);
		expect(result.status).toBe("refused");
	});

	test("a settings file past the size bound is refused unread, and left as it is", async () => {
		const content = `{"model": "opus", "padding": "${"x".repeat(MAX_SETTINGS_BYTES)}"}`;
		writeFileSync(settingsPath, content);
		const installed = await installTerminalHook(root, SPEC);
		expect(installed.status).toBe("refused");
		expect(installed.status === "refused" && installed.reason).toContain("larger than");
		expect((await removeTerminalHook(root)).status).toBe("refused");
		expect(readFileSync(settingsPath, "utf8")).toBe(content);
	});

	test("a file that starts with a byte order mark is read like the CLI reads it, and its keys are kept", async () => {
		writeFileSync(settingsPath, '\uFEFF{\n  "model": "opus"\n}\n');
		expect((await installTerminalHook(root, SPEC)).status).toBe("installed");
		expect(read().model).toBe("opus");
	});

	test("a URL that is not the loopback hook URL is refused", async () => {
		for (const url of [
			"https://example.com/cc-terminal-hook",
			"https://127.0.0.1:1/other",
			"https://127.0.0.1/cc-terminal-hook",
		]) {
			expect((await installTerminalHook(root, { ...SPEC, url })).status).toBe("refused");
		}
		expect(existsSync(settingsPath)).toBe(false);
	});
});

describe("removing the terminal ask hook", () => {
	test("a file the hook was installed into goes back to what it was, and a file without it is not rewritten", async () => {
		writeFileSync(settingsPath, `${JSON.stringify(USER_SETTINGS, null, 4)}\n`);
		const original = readFileSync(settingsPath, "utf8");
		expect(await removeTerminalHook(root)).toMatchObject({ status: "unchanged" });
		expect(readFileSync(settingsPath, "utf8")).toBe(original);
		await installTerminalHook(root, SPEC);
		expect(await removeTerminalHook(root)).toMatchObject({ status: "removed" });
		expect(read()).toEqual(USER_SETTINGS);
		expect(readFileSync(settingsPath, "utf8")).toBe(original);
	});

	test("a fresh file the install created ends as an empty object, with no key of ours left", async () => {
		await installTerminalHook(root, SPEC);
		await removeTerminalHook(root);
		expect(read()).toEqual({});
	});

	test("with no settings file there is nothing to remove and nothing is created", async () => {
		expect(await removeTerminalHook(join(root, "none"))).toMatchObject({ status: "unchanged" });
		expect(existsSync(join(root, "none"))).toBe(false);
	});

	test("a group that held our hook beside the user's keeps theirs", async () => {
		write({
			hooks: {
				PermissionRequest: [
					{
						hooks: [
							{ type: "command", command: "echo mine" },
							{ type: "http", url: SPEC.url, timeout: 5 },
						],
					},
				],
			},
		});
		await removeTerminalHook(root);
		expect(read()).toEqual({ hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: "echo mine" }] }] } });
	});

	test("the user's own http hook on another URL is not ours and stays", async () => {
		const theirs = { type: "http", url: "https://127.0.0.1:9000/their-hook", timeout: 5 };
		write({ hooks: { PermissionRequest: [{ hooks: [theirs] }] }, allowedHttpHookUrls: ["https://127.0.0.1:9000/*"] });
		await installTerminalHook(root, SPEC);
		await removeTerminalHook(root);
		expect(read()).toEqual({
			hooks: { PermissionRequest: [{ hooks: [theirs] }] },
			allowedHttpHookUrls: ["https://127.0.0.1:9000/*"],
		});
	});
});
