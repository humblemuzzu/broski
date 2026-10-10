import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CURRENT_PLATFORM,
	checkPortInUse,
	type DaemonConfig,
	findBinary,
	findProcessByPattern,
	generateDaemonConfig,
	getBroskiBinaryPath,
	getDaemonConfigPath,
	getDaemonType,
	getDefaultAllowedPaths,
	getHotspotInterfacePatterns,
	getKillPortHint,
	getNullDevice,
	getPreferredInterfaceNames,
	getProcessOnPort,
	getSleepPreventionTip,
	getTailLogsHint,
	getTailscaleBinaryPath,
	getTailscaleDownloadUrl,
	getTailscaleInstallHint,
	getTmpDir,
	IS_LINUX,
	IS_MACOS,
	IS_WINDOWS,
	isCompiledBinary,
} from "../platform";

describe("Platform Detection", () => {
	test("CURRENT_PLATFORM is a valid platform", () => {
		expect(["darwin", "linux", "win32"].includes(CURRENT_PLATFORM)).toBe(true);
	});

	test("exactly one platform flag is true", () => {
		const flags = [IS_WINDOWS, IS_MACOS, IS_LINUX];
		const trueCount = flags.filter(Boolean).length;
		expect(trueCount).toBe(1);
	});

	test("platform flags match CURRENT_PLATFORM", () => {
		switch (CURRENT_PLATFORM) {
			case "darwin":
				expect(IS_MACOS).toBe(true);
				expect(IS_LINUX).toBe(false);
				expect(IS_WINDOWS).toBe(false);
				break;
			case "linux":
				expect(IS_MACOS).toBe(false);
				expect(IS_LINUX).toBe(true);
				expect(IS_WINDOWS).toBe(false);
				break;
			case "win32":
				expect(IS_MACOS).toBe(false);
				expect(IS_LINUX).toBe(false);
				expect(IS_WINDOWS).toBe(true);
				break;
		}
	});
});

describe("Binary Detection", () => {
	test("findBinary returns string or null", () => {
		const result = findBinary("nonexistent-binary-xyz");
		expect(result === null || typeof result === "string").toBe(true);
	});

	test("findBinary finds common system binaries", () => {
		// Test with a binary that should exist on all platforms
		const nodeResult = findBinary("node");
		// Don't assert it exists since test environment might not have it,
		// just check return type is correct
		expect(nodeResult === null || typeof nodeResult === "string").toBe(true);
	});

	test("isCompiledBinary returns boolean", () => {
		const result = isCompiledBinary();
		expect(typeof result).toBe("boolean");
	});

	test("getBroskiBinaryPath returns string", () => {
		const result = getBroskiBinaryPath();
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});
});

describe("Daemon System", () => {
	test("getDaemonType returns valid daemon type", () => {
		const result = getDaemonType();
		expect(["launchagent", "systemd", "task-scheduler", "none"].includes(result)).toBe(true);
	});

	test("daemon type matches platform", () => {
		const type = getDaemonType();
		if (IS_MACOS) {
			expect(type).toBe("launchagent");
		} else if (IS_LINUX) {
			expect(type).toBe("systemd");
		} else if (IS_WINDOWS) {
			expect(type).toBe("task-scheduler");
		} else {
			expect(type).toBe("none");
		}
	});

	test("getDaemonConfigPath returns string", () => {
		const result = getDaemonConfigPath();
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("generateDaemonConfig produces correct output", () => {
		const tmp = mkdtempSync(join(tmpdir(), "broski-platform-"));
		try {
			const linkBinaryPath = join(tmp, "broski-link");
			writeFileSync(linkBinaryPath, "");

			const config: DaemonConfig = {
				binaryPath: "/usr/local/bin/broski",
				args: ["--daemon", "--hotspot"],
				logDir: "/home/user/.broski/logs",
				workDir: "/home/user",
				linkBinaryPath,
			};

			const result = generateDaemonConfig(config);

			if (IS_WINDOWS) {
				// Windows returns null (uses schtasks commands)
				expect(result).toBe(null);
			} else {
				// macOS/Linux return config content
				expect(typeof result).toBe("string");
				expect(result!.length).toBeGreaterThan(0);

				if (IS_MACOS) {
					expect(result).toContain("<?xml");
					expect(result).toContain("com.broski.link");
					expect(result).toContain("<string>run</string>");
					expect(result).toContain("<string>--bridge-cmd</string>");
					expect(result).toContain(linkBinaryPath);
					expect(result).toContain("<string>/usr/local/bin/broski</string>");
					// Startup crashes have to be diagnosable, so launchd owns link.log.
					expect(result).toContain("/home/user/.broski/logs/link.log");
					expect(result).not.toContain("<string>/dev/null</string>");
				} else if (IS_LINUX) {
					expect(result).toContain("[Unit]");
					expect(result).toContain("[Service]");
					expect(result).toContain("[Install]");
					expect(result).toContain(
						`ExecStart=${linkBinaryPath} run --bridge-cmd /usr/local/bin/broski --daemon --hotspot`,
					);
					expect(result).toContain("StandardOutput=append:/home/user/.broski/logs/link.log");
					expect(result).toContain("StandardError=append:/home/user/.broski/logs/link.log");
				}
			}
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("generateDaemonConfig reports a missing broski-link", () => {
		if (IS_WINDOWS) return;

		const config: DaemonConfig = {
			binaryPath: "/usr/local/bin/broski",
			args: ["--daemon"],
			logDir: "/home/user/.broski/logs",
			workDir: "/home/user",
			linkBinaryPath: "/usr/local/bin/does-not-exist-broski-link",
		};

		expect(() => generateDaemonConfig(config)).toThrow(/broski-link not found/);
	});
});

describe("System Helpers", () => {
	test("getNullDevice returns correct path", () => {
		const result = getNullDevice();
		if (IS_WINDOWS) {
			expect(result).toBe("NUL");
		} else {
			expect(result).toBe("/dev/null");
		}
	});

	test("getTmpDir returns string", () => {
		const result = getTmpDir();
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("getDefaultAllowedPaths returns array of strings", () => {
		const result = getDefaultAllowedPaths();
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBeGreaterThan(0);
		expect(result.every((p) => typeof p === "string")).toBe(true);
	});
});

describe("User-Facing Messages", () => {
	test("getKillPortHint returns platform-appropriate command", () => {
		const hint = getKillPortHint(8080);
		expect(typeof hint).toBe("string");
		expect(hint).toContain("8080");

		if (IS_WINDOWS) {
			expect(hint).toContain("netstat");
			expect(hint).toContain("taskkill");
		} else {
			expect(hint).toContain("kill");
			expect(hint).toContain("lsof");
		}
	});

	test("getTailLogsHint returns platform-appropriate command", () => {
		const hint = getTailLogsHint();
		expect(typeof hint).toBe("string");
		expect(hint).toContain(".broski");

		if (IS_WINDOWS) {
			expect(hint).toContain("Get-Content");
		} else {
			expect(hint).toContain("tail");
		}
	});

	test("getSleepPreventionTip returns platform-specific advice", () => {
		const tip = getSleepPreventionTip();
		expect(typeof tip).toBe("string");
		expect(tip.length).toBeGreaterThan(10);

		if (IS_MACOS) {
			expect(tip).toContain("Amphetamine");
		} else if (IS_LINUX) {
			expect(tip).toContain("systemctl");
		} else if (IS_WINDOWS) {
			expect(tip).toContain("powercfg");
		}
	});

	test("getTailscaleInstallHint returns platform-specific instructions", () => {
		const hint = getTailscaleInstallHint();
		expect(typeof hint).toBe("string");
		expect(hint.length).toBeGreaterThan(10);

		if (IS_MACOS) {
			expect(hint).toContain("brew");
		} else if (IS_LINUX) {
			expect(hint).toContain("curl");
		} else if (IS_WINDOWS) {
			expect(hint).toContain("winget");
		}
	});

	test("getTailscaleDownloadUrl returns valid URL", () => {
		const url = getTailscaleDownloadUrl();
		expect(typeof url).toBe("string");
		expect(url.startsWith("http") || url.startsWith("macappstore://")).toBe(true);
	});
});

describe("Network Interface Detection", () => {
	test("getPreferredInterfaceNames returns array", () => {
		const interfaces = getPreferredInterfaceNames();
		expect(Array.isArray(interfaces)).toBe(true);
		expect(interfaces.length).toBeGreaterThan(0);
		expect(interfaces.every((name) => typeof name === "string")).toBe(true);
	});

	test("getHotspotInterfacePatterns returns array", () => {
		const patterns = getHotspotInterfacePatterns();
		expect(Array.isArray(patterns)).toBe(true);
		expect(patterns.length).toBeGreaterThan(0);
		expect(patterns.every((pattern) => typeof pattern === "string")).toBe(true);
	});

	test("getTailscaleBinaryPath returns string", () => {
		const path = getTailscaleBinaryPath();
		expect(typeof path).toBe("string");
		expect(path.length).toBeGreaterThan(0);
	});
});

describe("Process Management", () => {
	test("checkPortInUse returns boolean", async () => {
		// Test with an unlikely-to-be-used port
		const result = await checkPortInUse(64999);
		expect(typeof result).toBe("boolean");
	});

	test("getProcessOnPort returns null or process info", async () => {
		// Test with an unlikely-to-be-used port
		const result = await getProcessOnPort(64999);
		expect(result === null || (typeof result === "object" && "pid" in result && "name" in result)).toBe(true);
	});

	test("findProcessByPattern returns array of numbers", () => {
		const result = findProcessByPattern("nonexistent-process-xyz");
		expect(Array.isArray(result)).toBe(true);
		expect(result.every((pid) => typeof pid === "number" && Number.isFinite(pid))).toBe(true);
	});
});
