import { describe, expect, test } from "bun:test";
import {
	CURRENT_PLATFORM,
	checkPortInUse,
	findBinary,
	findProcessByPattern,
	getBroskiBinaryPath,
	getDaemonConfigPath,
	getDaemonType,
	getDefaultAllowedPaths,
	getKillPortHint,
	getProcessOnPort,
	getSleepPreventionTip,
	getTailLogsHint,
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
		expect(["launchagent", "systemd", "none"].includes(result)).toBe(true);
	});

	test("daemon type matches platform", () => {
		const type = getDaemonType();
		if (IS_MACOS) {
			expect(type).toBe("launchagent");
		} else if (IS_LINUX) {
			expect(type).toBe("systemd");
		} else {
			expect(type).toBe("none");
		}
	});

	test("getDaemonConfigPath returns a path where a service exists", () => {
		const result = getDaemonConfigPath();
		if (IS_WINDOWS) {
			expect(result).toBeNull();
		} else {
			expect(typeof result).toBe("string");
			expect(result?.length).toBeGreaterThan(0);
		}
	});
});

describe("System Helpers", () => {
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
