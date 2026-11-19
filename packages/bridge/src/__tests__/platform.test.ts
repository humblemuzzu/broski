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
	IS_MACOS,
	isCompiledBinary,
} from "../platform";

describe("Platform Detection", () => {
	test("the desktop host is macOS", () => {
		expect(CURRENT_PLATFORM).toBe("darwin");
		expect(IS_MACOS).toBe(true);
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
		expect(["launchagent", "none"].includes(result)).toBe(true);
	});

	test("daemon type is the LaunchAgent on macOS", () => {
		expect(getDaemonType()).toBe("launchagent");
	});

	test("getDaemonConfigPath returns the LaunchAgent plist path", () => {
		const result = getDaemonConfigPath();
		expect(typeof result).toBe("string");
		expect(result?.length).toBeGreaterThan(0);
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
	test("getKillPortHint returns a command for the port", () => {
		const hint = getKillPortHint(8080);
		expect(typeof hint).toBe("string");
		expect(hint).toContain("8080");
		expect(hint).toContain("kill");
		expect(hint).toContain("lsof");
	});

	test("getTailLogsHint returns the tail command", () => {
		const hint = getTailLogsHint();
		expect(typeof hint).toBe("string");
		expect(hint).toContain(".broski");
		expect(hint).toContain("tail");
	});

	test("getSleepPreventionTip returns macOS advice", () => {
		const tip = getSleepPreventionTip();
		expect(typeof tip).toBe("string");
		expect(tip).toContain("Amphetamine");
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
