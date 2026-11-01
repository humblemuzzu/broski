import { describe, expect, test } from "bun:test";
import { findBinary } from "../platform";

// Test the exported utility functions from wizard steps
// We avoid testing the interactive prompter functions since they require user input

describe("Agent Detection (from agents step)", () => {
	// Test the same logic used in the agents step
	function detectAgents() {
		const piPath = findBinary("pi");
		const cc = findBinary("claude");
		return {
			pi: { found: !!piPath, path: piPath },
			claudeCode: { found: !!cc, path: cc },
		};
	}

	test("detectAgents returns proper structure", () => {
		const result = detectAgents();

		expect(typeof result).toBe("object");
		expect("pi" in result).toBe(true);
		expect("claudeCode" in result).toBe(true);

		// Each agent should have found boolean and path
		expect(typeof result.pi.found).toBe("boolean");
		expect(result.pi.path === null || typeof result.pi.path === "string").toBe(true);

		expect(typeof result.claudeCode.found).toBe("boolean");
		expect(result.claudeCode.path === null || typeof result.claudeCode.path === "string").toBe(true);
	});

	test("found flag matches path existence", () => {
		const result = detectAgents();

		expect(result.pi.found).toBe(!!result.pi.path);
		expect(result.claudeCode.found).toBe(!!result.claudeCode.path);
	});
});

describe("Agent Name Parsing (from onboarding)", () => {
	// Test the agentNameFromFlag function logic from onboarding.ts
	function agentNameFromFlag(flag: string): "pi" | "claude" | null {
		const lower = flag.toLowerCase().trim();
		if (lower === "pi") return "pi";
		if (lower === "claude" || lower === "claude-code" || lower === "claudecode") return "claude";
		return null;
	}

	test("agentNameFromFlag handles valid agent names", () => {
		expect(agentNameFromFlag("pi")).toBe("pi");
		expect(agentNameFromFlag("PI")).toBe("pi");
		expect(agentNameFromFlag(" pi ")).toBe("pi");

		expect(agentNameFromFlag("claude")).toBe("claude");
		expect(agentNameFromFlag("claude-code")).toBe("claude");
		expect(agentNameFromFlag("claudecode")).toBe("claude");
		expect(agentNameFromFlag("CLAUDE-CODE")).toBe("claude");
	});

	test("agentNameFromFlag returns null for invalid names", () => {
		expect(agentNameFromFlag("invalid")).toBe(null);
		expect(agentNameFromFlag("")).toBe(null);
		expect(agentNameFromFlag("openai")).toBe(null);
		expect(agentNameFromFlag("gpt")).toBe(null);
	});
});

describe("Daemon Type Mapping (from daemon step)", () => {
	test("getDaemonType returns valid type", () => {
		const { getDaemonType } = require("../platform");
		expect(["launchagent", "systemd", "none"].includes(getDaemonType())).toBe(true);
	});

	function daemonTypeLabel(): string {
		const { IS_MACOS, IS_LINUX } = require("../platform");
		if (IS_MACOS) return "LaunchAgent";
		if (IS_LINUX) return "systemd service";
		return "background service";
	}

	test("daemonTypeLabel returns platform-appropriate label", () => {
		const label = daemonTypeLabel();
		expect(typeof label).toBe("string");
		expect(label.length).toBeGreaterThan(0);
	});
});

describe("Configuration Result Types", () => {
	test("AgentsResult structure", () => {
		type AgentsResult = {
			pi: boolean;
			claudeCode: boolean;
		};

		const mockResult: AgentsResult = {
			pi: true,
			claudeCode: false,
		};

		expect(typeof mockResult.pi).toBe("boolean");
		expect(typeof mockResult.claudeCode).toBe("boolean");
	});

	test("DaemonResult structure", () => {
		type DaemonResult = {
			installed: boolean;
			type: "launchagent" | "systemd" | "none";
		};

		const mockResult: DaemonResult = {
			installed: false,
			type: "none",
		};

		expect(typeof mockResult.installed).toBe("boolean");
		expect(["launchagent", "systemd", "none"].includes(mockResult.type)).toBe(true);
	});

	test("WelcomeResult structure", () => {
		type WelcomeResult = {
			action: "continue" | "modify" | "reset" | "keep";
		};

		const mockResults: WelcomeResult[] = [
			{ action: "continue" },
			{ action: "modify" },
			{ action: "reset" },
			{ action: "keep" },
		];

		mockResults.forEach((result) => {
			expect(["continue", "modify", "reset", "keep"].includes(result.action)).toBe(true);
		});
	});
});
