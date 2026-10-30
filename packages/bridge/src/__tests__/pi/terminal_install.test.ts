/** The Broski link extension in the agent directory: put there once, kept current, never over somebody else's, taken out again; and not loaded by sessions the bridge hosts. */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTENSION_FILES } from "../../backends/pi/terminal/extension-sources";
import {
	extensionDirectory,
	extensionEntry,
	installExtension,
	isBroskiLink,
	MARKER,
	uninstallExtension,
} from "../../backends/pi/terminal/install";
import { TerminalLink } from "../../backends/pi/terminal/link";
import { LiveRig } from "./helpers/live-rig";
import { holdingRun } from "./helpers/live-steps";
import { say } from "./helpers/scenarios";
import { TerminalRig } from "./helpers/terminal-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

function agentDir(): string {
	return mkdtempSync(join(tmpdir(), "broski-agent-"));
}

const files = (dir: string) => readdirSync(extensionDirectory(dir)).sort();

describe("installing", () => {
	test("writes the three files, entry point marked, and says so once", () => {
		const dir = agentDir();
		expect(installExtension(dir)).toEqual({ kind: "installed" });
		expect(files(dir)).toEqual(["index.ts", "link.ts", "projection.ts"]);
		expect(readFileSync(extensionEntry(dir), "utf8").startsWith(MARKER)).toBe(true);
		expect(EXTENSION_FILES.map((file) => readFileSync(join(extensionDirectory(dir), file.name), "utf8"))).toEqual(
			EXTENSION_FILES.map((file) => file.content),
		);
		expect(installExtension(dir)).toEqual({ kind: "current" });
	});

	test("an installed file that differs is written again, and nothing else changes", () => {
		const dir = agentDir();
		installExtension(dir);
		const link = join(extensionDirectory(dir), "link.ts");
		writeFileSync(link, "// an older version\n");
		const untouched = statSync(extensionEntry(dir)).mtimeMs;
		expect(installExtension(dir)).toEqual({ kind: "updated" });
		expect(readFileSync(link, "utf8")).toBe(EXTENSION_FILES.find((file) => file.name === "link.ts")?.content ?? "");
		expect(statSync(extensionEntry(dir)).mtimeMs).toBe(untouched);
		expect(files(dir)).toEqual(["index.ts", "link.ts", "projection.ts"]);
	});

	test("leaves a folder of that name that is not the bridge's alone", () => {
		const dir = agentDir();
		mkdirSync(extensionDirectory(dir), { recursive: true });
		writeFileSync(extensionEntry(dir), "export default () => {};\n");
		const result = installExtension(dir);
		expect(result).toMatchObject({ kind: "problem" });
		expect(readFileSync(extensionEntry(dir), "utf8")).toBe("export default () => {};\n");
		expect(files(dir)).toEqual(["index.ts"]);
		expect(uninstallExtension(dir)).toMatchObject({ kind: "problem" });
		expect(existsSync(extensionEntry(dir))).toBe(true);
	});

	test("does not install where Pi would take the extensions folder for one extension", () => {
		const dir = agentDir();
		mkdirSync(join(dir, "extensions"), { recursive: true });
		writeFileSync(join(dir, "extensions", "index.ts"), "export default () => {};\n");
		expect(installExtension(dir)).toMatchObject({ kind: "problem" });
		expect(existsSync(extensionDirectory(dir))).toBe(false);
	});

	test("reports an agent directory it cannot write to instead of throwing", () => {
		const dir = agentDir();
		writeFileSync(join(dir, "extensions"), "a file where the folder should be");
		expect(installExtension(dir)).toMatchObject({ kind: "problem" });
	});
});

describe("uninstalling", () => {
	test("removes the files and the folder, and is absent the second time", () => {
		const dir = agentDir();
		installExtension(dir);
		expect(uninstallExtension(dir)).toEqual({ kind: "removed" });
		expect(existsSync(extensionDirectory(dir))).toBe(false);
		expect(uninstallExtension(dir)).toEqual({ kind: "absent" });
	});

	test("keeps a file in the folder that is somebody's", () => {
		const dir = agentDir();
		installExtension(dir);
		writeFileSync(join(extensionDirectory(dir), "notes.md"), "mine");
		expect(uninstallExtension(dir)).toEqual({ kind: "removed" });
		expect(files(dir)).toEqual(["notes.md"]);
	});
});

describe("the switch in the bridge's config", () => {
	const callbacks = { now: Date.now, busy: () => false, changed: () => {} };

	test("on: installs and listens; off: takes the extension out and listens on nothing", async () => {
		const dir = agentDir();
		const directory = join(mkdtempSync(join(tmpdir(), "broski-link-")), "socket");
		const on = new TerminalLink(dir, { enabled: true, directory }, callbacks);
		await on.start();
		expect(existsSync(extensionEntry(dir))).toBe(true);
		expect(existsSync(join(directory, "bridge.sock"))).toBe(true);
		await on.stop();

		const other = join(mkdtempSync(join(tmpdir(), "broski-link-")), "socket");
		const off = new TerminalLink(dir, { enabled: false, directory: other }, callbacks);
		await off.start();
		expect(existsSync(extensionDirectory(dir))).toBe(false);
		expect(existsSync(other)).toBe(false);
		expect(off.problem()).toBeUndefined();
	});

	test("a failure to install is reported, and nothing listens", async () => {
		const dir = agentDir();
		writeFileSync(join(dir, "extensions"), "a file");
		const directory = join(mkdtempSync(join(tmpdir(), "broski-link-")), "socket");
		const link = new TerminalLink(dir, { enabled: true, directory }, callbacks);
		await link.start();
		expect(link.problem()).toContain("could not be installed");
		expect(existsSync(directory)).toBe(false);
	});

	test("a bridge started without the link option installs nothing", async () => {
		const dir = agentDir();
		await new TerminalLink(dir, undefined, callbacks).start();
		expect(existsSync(join(dir, "extensions"))).toBe(false);
	});
});

describe("the entry point Pi names", () => {
	test("is recognised by path, however it is spelled", () => {
		const dir = agentDir();
		expect(isBroskiLink(dir, extensionEntry(dir))).toBe(true);
		expect(isBroskiLink(dir, join(dir, "extensions", "broski-link", ".", "index.ts"))).toBe(true);
		expect(isBroskiLink(dir, join(dir, "extensions", "other", "index.ts"))).toBe(false);
	});
});

describe("in a session the bridge hosts", () => {
	test("Pi finds the installed extension for a terminal and the bridge's own sessions load without it", async () => {
		t = await LiveRig.create({ link: true });
		const entry = extensionEntry(t.world.env.agentDir);
		expect(existsSync(entry)).toBe(true);

		const terminals = new TerminalRig(t);
		const terminal = await terminals.open();
		const loaded = terminal.session.extensionRunner.getExtensionPaths();
		expect(loaded.some((path) => isBroskiLink(t?.world.env.agentDir ?? "", path))).toBe(true);
		await terminals.quit();

		const live = await holdingRun(t);
		const hosted = t.world.parts.hosts.session(live.ref.sessionId);
		const paths = hosted?.extensionRunner.getExtensionPaths() ?? [];
		expect(paths.length).toBeGreaterThan(0);
		expect(paths.some((path) => isBroskiLink(t?.world.env.agentDir ?? "", path))).toBe(false);
		expect(t.world.parts.terminal.registry.session(t.fileOf(live.ref))).toBeUndefined();
		t.bus.release(live.ref.sessionId);
		await live.waitFor("run_finished", () => true);
		await live.close();
	});

	test("a session the bridge hosts, opened in a terminal while it runs, warns the terminal's user", async () => {
		t = await LiveRig.create({ link: true });
		const live = await holdingRun(t);
		const terminals = new TerminalRig(t);
		const file = t.fileOf(live.ref);
		await terminals.open(file);
		await terminals.connected(file);
		await terminals.noticed();
		expect(terminals.notices.some((text) => text.includes("phone"))).toBe(true);
		t.router.script(live.ref.sessionId, [say("never used")]);
		t.bus.release(live.ref.sessionId);
		await live.waitFor("run_finished", () => true);
		await live.close();
	});
});
