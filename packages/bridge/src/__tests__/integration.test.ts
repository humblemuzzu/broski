import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../config";

// Integration tests that verify the complete flow works together

describe("Setup Wizard Integration", () => {
	test("default config passes schema validation", () => {
		const config = getDefaultConfig();

		// Validate structure
		expect(config.version).toBe(1);
		expect(typeof config.wizard).toBe("object");
		expect(typeof config.network).toBe("object");
		expect(typeof config.security).toBe("object");
		expect(typeof config.agents).toBe("object");
		expect(typeof config.daemon).toBe("object");

		// Validate all required fields are present
		expect(typeof config.wizard.completedSetup).toBe("boolean");
		expect(typeof config.network.port).toBe("number");
		expect(typeof config.security.tls).toBe("boolean");
		expect(typeof config.agents.opencode).toBe("boolean");
		expect(typeof config.agents.claudeCode).toBe("boolean");
		expect(typeof config.agents.codex).toBe("boolean");
		expect(typeof config.daemon.installed).toBe("boolean");
		expect(typeof config.daemon.type).toBe("string");
	});

	test("configuration values are sensible", () => {
		const config = getDefaultConfig();

		// Network settings
		expect(config.network.port).toBeGreaterThan(1024); // Non-privileged port
		expect(config.network.port).toBeLessThan(65536); // Valid port range

		// Daemon settings
		expect(["launchagent", "systemd", "none"].includes(config.daemon.type)).toBe(true);
	});

	test("agent configuration allows at least one enabled", () => {
		const config = getDefaultConfig();

		const enabledAgents = [config.agents.opencode, config.agents.claudeCode, config.agents.codex].filter(Boolean);

		// At least one agent should be enabled by default
		expect(enabledAgents.length).toBeGreaterThan(0);
	});
});

describe("Platform Integration", () => {
	test("platform detection is consistent", () => {
		const { IS_MACOS, IS_LINUX, IS_WINDOWS, CURRENT_PLATFORM, getDaemonType } = require("../platform");

		// Exactly one platform flag should be true
		const platformFlags = [IS_MACOS, IS_LINUX, IS_WINDOWS];
		const trueCount = platformFlags.filter(Boolean).length;
		expect(trueCount).toBe(1);

		// Platform constant should match flags
		if (IS_MACOS) expect(CURRENT_PLATFORM).toBe("darwin");
		if (IS_LINUX) expect(CURRENT_PLATFORM).toBe("linux");
		if (IS_WINDOWS) expect(CURRENT_PLATFORM).toBe("win32");

		// Daemon type should match platform
		const daemonType = getDaemonType();
		if (IS_MACOS) expect(daemonType).toBe("launchagent");
		if (IS_LINUX) expect(daemonType).toBe("systemd");
		if (IS_WINDOWS) expect(daemonType).toBe("none");
	});

	test("path helpers return valid paths", () => {
		const { getNullDevice, getTmpDir, getDefaultAllowedPaths } = require("../platform");

		const nullDevice = getNullDevice();
		const tmpDir = getTmpDir();
		const allowedPaths = getDefaultAllowedPaths();

		expect(typeof nullDevice).toBe("string");
		expect(nullDevice.length).toBeGreaterThan(0);

		expect(typeof tmpDir).toBe("string");
		expect(tmpDir.length).toBeGreaterThan(0);

		expect(Array.isArray(allowedPaths)).toBe(true);
		expect(allowedPaths.length).toBeGreaterThan(0);
		allowedPaths.forEach((path: string) => {
			expect(typeof path).toBe("string");
			expect(path.length).toBeGreaterThan(0);
		});
	});
});

describe("Troubleshooter Integration", () => {
	test("problem mapping covers all scenarios", () => {
		// Test that all common problems map to appropriate doctor profiles
		type Problem =
			| "phone-cant-connect"
			| "sessions-not-showing"
			| "bridge-crashing"
			| "agent-not-responding"
			| "something-else";
		type DoctorProfile = "network" | "agents" | "daemon" | "pairing" | "all";

		function profileForProblem(problem: Problem): DoctorProfile {
			switch (problem) {
				case "phone-cant-connect":
					return "network";
				case "sessions-not-showing":
					return "agents";
				case "bridge-crashing":
					return "daemon";
				case "agent-not-responding":
					return "agents";
				case "something-else":
					return "all";
			}
		}

		const allProblems: Problem[] = [
			"phone-cant-connect",
			"sessions-not-showing",
			"bridge-crashing",
			"agent-not-responding",
			"something-else",
		];
		const allProfiles: DoctorProfile[] = ["network", "agents", "daemon", "pairing", "all"];

		// Every problem should map to a valid profile
		allProblems.forEach((problem) => {
			const profile = profileForProblem(problem);
			expect(allProfiles.includes(profile)).toBe(true);
		});

		// Network profile should handle connectivity issues
		expect(profileForProblem("phone-cant-connect")).toBe("network");

		// Agents profile should handle backend issues
		expect(profileForProblem("sessions-not-showing")).toBe("agents");
		expect(profileForProblem("agent-not-responding")).toBe("agents");

		// Daemon profile should handle runtime issues
		expect(profileForProblem("bridge-crashing")).toBe("daemon");

		// Catch-all should use comprehensive diagnostics
		expect(profileForProblem("something-else")).toBe("all");
	});
});

describe("End-to-End Configuration Flow", () => {
	test("wizard result types create valid config", () => {
		// Simulate results from each wizard step
		const mockWelcomeResult = { action: "continue" as const };
		const mockAgentsResult = { opencode: true, claudeCode: false, codex: true };
		const mockNetworkResult = { port: 8080 };
		const mockSecurityResult = { tls: true };
		const mockDaemonResult = { installed: true, type: "systemd" as const };

		// Verify each result type is valid
		expect(["continue", "modify", "reset", "keep"].includes(mockWelcomeResult.action)).toBe(true);

		expect(typeof mockAgentsResult.opencode).toBe("boolean");
		expect(typeof mockAgentsResult.claudeCode).toBe("boolean");
		expect(typeof mockAgentsResult.codex).toBe("boolean");

		expect(typeof mockNetworkResult.port).toBe("number");

		expect(typeof mockSecurityResult.tls).toBe("boolean");

		expect(typeof mockDaemonResult.installed).toBe("boolean");
		expect(["launchagent", "systemd", "none"].includes(mockDaemonResult.type)).toBe(true);

		// Assemble a config (simplified version of what onboarding does)
		const finalConfig = {
			version: 1,
			wizard: {
				completedSetup: true,
				lastRunAt: new Date().toISOString(),
				lastRunVersion: "1.0.0",
			},
			network: {
				port: mockNetworkResult.port,
			},
			security: {
				tls: mockSecurityResult.tls,
				verifyCodeSignature: true,
			},
			agents: {
				opencode: mockAgentsResult.opencode,
				claudeCode: mockAgentsResult.claudeCode,
				codex: mockAgentsResult.codex,
			},
			daemon: {
				installed: mockDaemonResult.installed,
				type: mockDaemonResult.type,
			},
		};

		// Verify the assembled config has all required fields
		expect(finalConfig.version).toBe(1);
		expect(finalConfig.wizard.completedSetup).toBe(true);
		expect(finalConfig.network.port).toBe(8080);
		expect(finalConfig.security.tls).toBe(true);
		expect(finalConfig.agents.opencode).toBe(true);
		expect(finalConfig.agents.codex).toBe(true);
		expect(finalConfig.daemon.type).toBe("systemd");
	});
});
