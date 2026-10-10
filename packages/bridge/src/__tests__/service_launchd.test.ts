import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as launchd from "../platform/service/launchd";
import type { DaemonConfig } from "../platform/service/types";
import { commandLines, recordCommands } from "./service_test_helpers";

const CONFIG: DaemonConfig = {
	binaryPath: "/opt/broski/bin/broski",
	args: ["--daemon"],
	logDir: "/home/tester/.broski/logs",
	workDir: "/home/tester",
};

describe("launchd plist generation", () => {
	const plist = launchd.generatePlist(CONFIG, "/opt/broski/bin/broski-link", "/home/tester");

	test("ProgramArguments start broski-link and hand it the bridge command", () => {
		expect(plist).toContain(
			[
				"    <array>",
				"        <string>/opt/broski/bin/broski-link</string>",
				"        <string>run</string>",
				"        <string>--bridge-cmd</string>",
				"        <string>/opt/broski/bin/broski</string>",
				"        <string>--daemon</string>",
				"    </array>",
			].join("\n"),
		);
	});

	test("label is com.broski.link, not the legacy com.broski.bridge", () => {
		expect(plist).toContain("<key>Label</key>\n    <string>com.broski.link</string>");
		expect(plist).not.toContain("com.broski.bridge");
	});

	test("runs at load, restarts on crash, throttles to 10s", () => {
		expect(plist).toContain("<key>RunAtLoad</key>\n    <true/>");
		expect(plist).toContain(
			[
				"    <key>KeepAlive</key>",
				"    <dict>",
				"        <key>SuccessfulExit</key>",
				"        <false/>",
				"    </dict>",
			].join("\n"),
		);
		expect(plist).toContain("<key>ThrottleInterval</key>\n    <integer>10</integer>");
	});

	test("stdout and stderr land in link.log, not /dev/null", () => {
		expect(plist).toContain("<key>StandardOutPath</key>\n    <string>/home/tester/.broski/logs/link.log</string>");
		expect(plist).toContain("<key>StandardErrorPath</key>\n    <string>/home/tester/.broski/logs/link.log</string>");
		expect(plist).not.toContain("/dev/null");
	});

	test("working directory and HOME come from the config and the home argument", () => {
		expect(plist).toContain("<key>WorkingDirectory</key>\n    <string>/home/tester</string>");
		expect(plist).toContain("<key>HOME</key>\n        <string>/home/tester</string>");
	});

	test("paths are XML escaped", () => {
		const escaped = launchd.generatePlist({ ...CONFIG, workDir: "/home/a&b" }, "/opt/broski-link", "/home/a&b");
		expect(escaped).toContain("<string>/home/a&amp;b</string>");
	});
});

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "broski-launchd-"));
}

function installableConfig(home: string): DaemonConfig {
	const binDir = join(home, "bin");
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, "broski"), "");
	writeFileSync(join(binDir, "broski-link"), "");
	return { ...CONFIG, binaryPath: join(binDir, "broski"), logDir: join(home, ".broski", "logs") };
}

describe("launchd install on a temp home", () => {
	test("writes the plist, bootstraps it, and removes the legacy agent", async () => {
		const home = tempHome();
		try {
			const legacyPath = launchd.legacyAgentPlistPath(home);
			mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
			writeFileSync(legacyPath, "legacy");

			const { host, calls } = recordCommands({ home });
			await launchd.install(host, installableConfig(home));

			expect(commandLines(calls)).toEqual([
				"launchctl bootout gui/501/com.broski.bridge",
				`launchctl bootstrap gui/501 ${launchd.agentPlistPath(home)}`,
			]);
			expect(existsSync(legacyPath)).toBe(false);

			const written = readFileSync(launchd.agentPlistPath(home), "utf-8");
			expect(written).toContain(`<string>${join(home, "bin", "broski-link")}</string>`);
			expect(written).toContain("<string>com.broski.link</string>");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("boots out an already loaded agent before rewriting it", async () => {
		const home = tempHome();
		try {
			const config = installableConfig(home);
			mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
			writeFileSync(launchd.agentPlistPath(home), "stale");

			const { host, calls } = recordCommands({ home });
			await launchd.install(host, config);

			expect(commandLines(calls)[0]).toBe("launchctl bootout gui/501/com.broski.link");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("falls back to launchctl load when bootstrap is unavailable", async () => {
		const home = tempHome();
		try {
			const { host, calls } = recordCommands({
				home,
				reply: (cmd, args) =>
					cmd === "launchctl" && args[0] === "bootstrap" ? { ok: false, stderr: "Unrecognized subcommand" } : undefined,
			});
			await launchd.install(host, installableConfig(home));

			expect(commandLines(calls)).toContain(`launchctl load ${launchd.agentPlistPath(home)}`);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("a failing bootstrap is reported instead of being retried with load", async () => {
		const home = tempHome();
		try {
			const { host, calls } = recordCommands({
				home,
				reply: (cmd, args) =>
					cmd === "launchctl" && args[0] === "bootstrap"
						? { ok: false, stderr: "Bootstrap failed: 5: Input/output error" }
						: undefined,
			});

			await expect(launchd.install(host, installableConfig(home))).rejects.toThrow(/Bootstrap failed/);
			expect(commandLines(calls).some((line) => line.startsWith("launchctl load"))).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("fails when --link-bin points at a missing file", async () => {
		const home = tempHome();
		try {
			const binDir = join(home, "bin");
			mkdirSync(binDir, { recursive: true });
			writeFileSync(join(binDir, "broski"), "");

			const { host } = recordCommands({ home });
			const config: DaemonConfig = {
				...CONFIG,
				binaryPath: join(binDir, "broski"),
				logDir: home,
				linkBinaryPath: join(binDir, "not-a-binary"),
			};
			await expect(launchd.install(host, config)).rejects.toThrow(/broski-link not found at .*not-a-binary/);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe("launchd status, stop, restart, uninstall", () => {
	test("reports not installed when the plist is absent", async () => {
		const home = tempHome();
		try {
			const { host, calls } = recordCommands({ home });
			const status = await launchd.status(host);
			expect(status).toEqual({
				installed: false,
				running: false,
				type: "launchagent",
				configPath: launchd.agentPlistPath(home),
				pid: null,
			});
			expect(calls).toEqual([]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("reads the pid out of launchctl list", async () => {
		const home = tempHome();
		try {
			mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
			writeFileSync(launchd.agentPlistPath(home), "plist");

			const { host } = recordCommands({
				home,
				reply: (cmd, args) =>
					cmd === "launchctl" && args[0] === "list" ? { stdout: "4242\t0\tcom.broski.link" } : undefined,
			});
			const status = await launchd.status(host);
			expect(status.installed).toBe(true);
			expect(status.running).toBe(true);
			expect(status.pid).toBe(4242);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("reads the pid out of the job dictionary launchctl list prints", async () => {
		const home = tempHome();
		try {
			mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
			writeFileSync(launchd.agentPlistPath(home), "plist");

			const { host } = recordCommands({
				home,
				reply: (cmd, args) =>
					cmd === "launchctl" && args[0] === "list"
						? { stdout: '{\n\t"Label" = "com.broski.link";\n\t"PID" = 918;\n}' }
						: undefined,
			});
			const status = await launchd.status(host);
			expect(status.running).toBe(true);
			expect(status.pid).toBe(918);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("stop signals the job and falls back to launchctl stop", async () => {
		const home = tempHome();
		try {
			const clean = recordCommands({ home });
			await launchd.stop(clean.host);
			expect(commandLines(clean.calls)).toEqual(["launchctl kill SIGTERM gui/501/com.broski.link"]);

			const legacy = recordCommands({
				home,
				reply: (cmd, args) => (cmd === "launchctl" && args[0] === "kill" ? { ok: false, status: 113 } : undefined),
			});
			await launchd.stop(legacy.host);
			expect(commandLines(legacy.calls)).toEqual([
				"launchctl kill SIGTERM gui/501/com.broski.link",
				"launchctl stop com.broski.link",
			]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("restart kickstarts the job", async () => {
		const home = tempHome();
		try {
			const { host, calls } = recordCommands({ home });
			await launchd.restart(host);
			expect(commandLines(calls)).toEqual(["launchctl kickstart -k gui/501/com.broski.link"]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("restart reloads the plist when kickstart is unavailable", async () => {
		const home = tempHome();
		try {
			mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
			writeFileSync(launchd.agentPlistPath(home), "plist");

			const { host, calls } = recordCommands({
				home,
				reply: (cmd, args) => (cmd === "launchctl" && args[0] === "kickstart" ? { ok: false, status: 113 } : undefined),
			});
			await launchd.restart(host);

			expect(commandLines(calls)).toEqual([
				"launchctl kickstart -k gui/501/com.broski.link",
				"launchctl bootout gui/501/com.broski.link",
				`launchctl bootstrap gui/501 ${launchd.agentPlistPath(home)}`,
			]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("uninstall boots the job out and deletes the plist", async () => {
		const home = tempHome();
		try {
			mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
			writeFileSync(launchd.agentPlistPath(home), "plist");

			const { host, calls } = recordCommands({ home });
			await launchd.uninstall(host);

			expect(commandLines(calls)).toEqual(["launchctl bootout gui/501/com.broski.link"]);
			expect(existsSync(launchd.agentPlistPath(home))).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
