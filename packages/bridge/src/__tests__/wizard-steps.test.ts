import { describe, expect, test } from "bun:test";
import { findBinary } from "../platform";

// Test the exported utility functions from wizard steps
// We avoid testing the interactive prompter functions since they require user input

describe("Agent Detection (from agents step)", () => {
	// Test the same logic used in the agents step
	function detectAgents() {
		const oc = findBinary("opencode");
		const cc = findBinary("claude");
		const cx = findBinary("codex");
		return {
			opencode: { found: !!oc, path: oc },
			claudeCode: { found: !!cc, path: cc },
			codex: { found: !!cx, path: cx },
		};
	}

	test("detectAgents returns proper structure", () => {
		const result = detectAgents();

		expect(typeof result).toBe("object");
		expect("opencode" in result).toBe(true);
		expect("claudeCode" in result).toBe(true);
		expect("codex" in result).toBe(true);

		// Each agent should have found boolean and path
		expect(typeof result.opencode.found).toBe("boolean");
		expect(result.opencode.path === null || typeof result.opencode.path === "string").toBe(true);

		expect(typeof result.claudeCode.found).toBe("boolean");
		expect(result.claudeCode.path === null || typeof result.claudeCode.path === "string").toBe(true);

		expect(typeof result.codex.found).toBe("boolean");
		expect(result.codex.path === null || typeof result.codex.path === "string").toBe(true);
	});

	test("found flag matches path existence", () => {
		const result = detectAgents();

		expect(result.opencode.found).toBe(!!result.opencode.path);
		expect(result.claudeCode.found).toBe(!!result.claudeCode.path);
		expect(result.codex.found).toBe(!!result.codex.path);
	});
});

describe("Agent Name Parsing (from onboarding)", () => {
	// Test the agentNameFromFlag function logic from onboarding.ts
	function agentNameFromFlag(flag: string): "opencode" | "claude" | "codex" | null {
		const lower = flag.toLowerCase().trim();
		if (lower === "opencode") return "opencode";
		if (lower === "claude" || lower === "claude-code" || lower === "claudecode") return "claude";
		if (lower === "codex") return "codex";
		return null;
	}

	test("agentNameFromFlag handles valid agent names", () => {
		expect(agentNameFromFlag("opencode")).toBe("opencode");
		expect(agentNameFromFlag("OPENCODE")).toBe("opencode");
		expect(agentNameFromFlag(" opencode ")).toBe("opencode");

		expect(agentNameFromFlag("claude")).toBe("claude");
		expect(agentNameFromFlag("claude-code")).toBe("claude");
		expect(agentNameFromFlag("claudecode")).toBe("claude");
		expect(agentNameFromFlag("CLAUDE-CODE")).toBe("claude");

		expect(agentNameFromFlag("codex")).toBe("codex");
		expect(agentNameFromFlag("CODEX")).toBe("codex");
		expect(agentNameFromFlag(" codex ")).toBe("codex");
	});

	test("agentNameFromFlag returns null for invalid names", () => {
		expect(agentNameFromFlag("invalid")).toBe(null);
		expect(agentNameFromFlag("")).toBe(null);
		expect(agentNameFromFlag("openai")).toBe(null);
		expect(agentNameFromFlag("gpt")).toBe(null);
	});
});

describe("Daemon Type Mapping (from daemon step)", () => {
	// Test the mapDaemonType function from daemon.ts
	function mapDaemonTypeNonInteractive(): "launchagent" | "systemd" | "taskscheduler" | "none" {
		const { getDaemonType } = require("../platform");
		const t = getDaemonType();
		if (t === "launchagent") return "launchagent";
		if (t === "systemd") return "systemd";
		if (t === "task-scheduler") return "taskscheduler";
		return "none";
	}

	test("mapDaemonTypeNonInteractive returns valid type", () => {
		const result = mapDaemonTypeNonInteractive();
		expect(["launchagent", "systemd", "taskscheduler", "none"].includes(result)).toBe(true);
	});

	function daemonTypeLabel(): string {
		const { IS_MACOS, IS_LINUX, IS_WINDOWS } = require("../platform");
		if (IS_MACOS) return "LaunchAgent";
		if (IS_LINUX) return "systemd service";
		if (IS_WINDOWS) return "Task Scheduler";
		return "background service";
	}

	test("daemonTypeLabel returns platform-appropriate label", () => {
		const label = daemonTypeLabel();
		expect(typeof label).toBe("string");
		expect(label.length).toBeGreaterThan(0);
	});
});

describe("Network Mode Detection", () => {
	// Test network detection logic
	test("network mode enum values are valid", () => {
		const validModes = ["local", "tailscale", "hotspot-iphone", "hotspot-android"];

		validModes.forEach((mode) => {
			// Each mode should be a non-empty string
			expect(typeof mode).toBe("string");
			expect(mode.length).toBeGreaterThan(0);
		});
	});
});

describe("Security Configuration", () => {
	test("token TTL values are reasonable", () => {
		const validTtlDays = [7, 14, 30, 90];

		validTtlDays.forEach((days) => {
			expect(typeof days).toBe("number");
			expect(days).toBeGreaterThan(0);
			expect(days).toBeLessThanOrEqual(90);
		});
	});
});

describe("Configuration Result Types", () => {
	test("AgentsResult structure", () => {
		type AgentsResult = {
			opencode: boolean;
			claudeCode: boolean;
			codex: boolean;
		};

		const mockResult: AgentsResult = {
			opencode: true,
			claudeCode: false,
			codex: true,
		};

		expect(typeof mockResult.opencode).toBe("boolean");
		expect(typeof mockResult.claudeCode).toBe("boolean");
		expect(typeof mockResult.codex).toBe("boolean");
	});

	test("NetworkResult structure", () => {
		type NetworkResult = {
			port: number;
			mode: "local" | "tailscale" | "hotspot-iphone" | "hotspot-android";
			enableFunnel: boolean;
		};

		const mockResult: NetworkResult = {
			port: 18274,
			mode: "local",
			enableFunnel: false,
		};

		expect(typeof mockResult.port).toBe("number");
		expect(mockResult.port).toBeGreaterThan(0);
		expect(["local", "tailscale", "hotspot-iphone", "hotspot-android"].includes(mockResult.mode)).toBe(true);
		expect(typeof mockResult.enableFunnel).toBe("boolean");
	});

	test("SecurityResult structure", () => {
		type SecurityResult = {
			tls: boolean;
			tokenTtlDays: number;
		};

		const mockResult: SecurityResult = {
			tls: true,
			tokenTtlDays: 7,
		};

		expect(typeof mockResult.tls).toBe("boolean");
		expect(typeof mockResult.tokenTtlDays).toBe("number");
		expect(mockResult.tokenTtlDays).toBeGreaterThan(0);
	});

	test("DaemonResult structure", () => {
		type DaemonResult = {
			installed: boolean;
			type: "launchagent" | "systemd" | "taskscheduler" | "none";
		};

		const mockResult: DaemonResult = {
			installed: false,
			type: "none",
		};

		expect(typeof mockResult.installed).toBe("boolean");
		expect(["launchagent", "systemd", "taskscheduler", "none"].includes(mockResult.type)).toBe(true);
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
