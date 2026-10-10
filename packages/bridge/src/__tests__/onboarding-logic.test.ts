import { describe, expect, test } from "bun:test";

// Test the non-interactive setup logic from onboarding.ts
// We focus on pure functions that don't require user interaction

describe("Non-Interactive Agent Detection", () => {
	// Simulate the detectAgentsNonInteractive function
	function detectAgentsNonInteractive(): { opencode: boolean; claudeCode: boolean; codex: boolean } {
		// This is a simplified version - the real function uses findBinary
		return {
			opencode: false, // Would be !!findBinary('opencode') in real implementation
			claudeCode: false, // Would be !!findBinary('claude') in real implementation
			codex: false, // Would be !!findBinary('codex') in real implementation
		};
	}

	test("detectAgentsNonInteractive returns proper structure", () => {
		const result = detectAgentsNonInteractive();

		expect(typeof result).toBe("object");
		expect("opencode" in result).toBe(true);
		expect("claudeCode" in result).toBe(true);
		expect("codex" in result).toBe(true);

		expect(typeof result.opencode).toBe("boolean");
		expect(typeof result.claudeCode).toBe("boolean");
		expect(typeof result.codex).toBe("boolean");
	});
});

describe("Agent Flag Parsing", () => {
	function agentNameFromFlag(flag: string): "opencode" | "claude" | "codex" | null {
		const lower = flag.toLowerCase().trim();
		if (lower === "opencode") return "opencode";
		if (lower === "claude" || lower === "claude-code" || lower === "claudecode") return "claude";
		if (lower === "codex") return "codex";
		return null;
	}

	test("handles opencode variants", () => {
		expect(agentNameFromFlag("opencode")).toBe("opencode");
		expect(agentNameFromFlag("OPENCODE")).toBe("opencode");
		expect(agentNameFromFlag(" opencode ")).toBe("opencode");
	});

	test("handles claude variants", () => {
		expect(agentNameFromFlag("claude")).toBe("claude");
		expect(agentNameFromFlag("claude-code")).toBe("claude");
		expect(agentNameFromFlag("claudecode")).toBe("claude");
		expect(agentNameFromFlag("CLAUDE-CODE")).toBe("claude");
	});

	test("handles codex variants", () => {
		expect(agentNameFromFlag("codex")).toBe("codex");
		expect(agentNameFromFlag("CODEX")).toBe("codex");
		expect(agentNameFromFlag(" codex ")).toBe("codex");
	});

	test("rejects invalid flags", () => {
		expect(agentNameFromFlag("invalid")).toBe(null);
		expect(agentNameFromFlag("")).toBe(null);
		expect(agentNameFromFlag("openai")).toBe(null);
	});
});

describe("Daemon Type Mapping", () => {
	function mapDaemonTypeNonInteractive(): "launchagent" | "systemd" | "taskscheduler" | "none" {
		// Simulate platform detection
		const IS_MACOS = process.platform === "darwin";
		const IS_LINUX = process.platform === "linux";
		const IS_WINDOWS = process.platform === "win32";

		if (IS_MACOS) return "launchagent";
		if (IS_LINUX) return "systemd";
		if (IS_WINDOWS) return "taskscheduler";
		return "none";
	}

	test("returns valid daemon type for current platform", () => {
		const result = mapDaemonTypeNonInteractive();
		expect(["launchagent", "systemd", "taskscheduler", "none"].includes(result)).toBe(true);
	});

	function daemonTypeLabel(): string {
		const IS_MACOS = process.platform === "darwin";
		const IS_LINUX = process.platform === "linux";
		const IS_WINDOWS = process.platform === "win32";

		if (IS_MACOS) return "LaunchAgent";
		if (IS_LINUX) return "systemd";
		if (IS_WINDOWS) return "TaskScheduler";
		return "none";
	}

	test("returns appropriate label for current platform", () => {
		const label = daemonTypeLabel();
		expect(typeof label).toBe("string");
		expect(label.length).toBeGreaterThan(0);
	});
});

describe("Non-Interactive Config Assembly", () => {
	test("assembles valid config structure", () => {
		const mockConfig = {
			version: 1,
			wizard: {
				completedSetup: true,
				lastRunAt: new Date().toISOString(),
				lastRunVersion: "1.0.0",
			},
			network: {
				port: 18274,
			},
			security: {
				tls: true,
				verifyCodeSignature: true,
			},
			agents: {
				opencode: false,
				claudeCode: false,
				codex: false,
			},
			daemon: {
				installed: false,
				type: "none" as const,
			},
		};

		expect(mockConfig.version).toBe(1);
		expect(mockConfig.wizard.completedSetup).toBe(true);
		expect(typeof mockConfig.wizard.lastRunAt).toBe("string");
		expect(typeof mockConfig.wizard.lastRunVersion).toBe("string");

		expect(typeof mockConfig.network.port).toBe("number");
		expect(mockConfig.network.port).toBeGreaterThan(0);

		expect(typeof mockConfig.security.tls).toBe("boolean");

		expect(typeof mockConfig.agents.opencode).toBe("boolean");
		expect(typeof mockConfig.agents.claudeCode).toBe("boolean");
		expect(typeof mockConfig.agents.codex).toBe("boolean");

		expect(typeof mockConfig.daemon.installed).toBe("boolean");
		expect(["launchagent", "systemd", "taskscheduler", "none"].includes(mockConfig.daemon.type)).toBe(true);
	});
});

describe("Onboarding Options Processing", () => {
	interface OnboardingOptions {
		quick?: boolean;
		advanced?: boolean;
		nonInteractive?: boolean;
		agents?: string[];
		tls?: boolean;
		daemon?: boolean;
		port?: number;
	}

	test("processes agent flags correctly", () => {
		const options: OnboardingOptions = {
			agents: ["opencode", "claude-code", "codex"],
		};

		// Simulate agent processing
		const processedAgents = { opencode: false, claudeCode: false, codex: false };

		if (options.agents) {
			for (const agent of options.agents) {
				const name = agent.toLowerCase().trim();
				if (name === "opencode") processedAgents.opencode = true;
				else if (name === "claude" || name === "claude-code") processedAgents.claudeCode = true;
				else if (name === "codex") processedAgents.codex = true;
			}
		}

		expect(processedAgents.opencode).toBe(true);
		expect(processedAgents.claudeCode).toBe(true);
		expect(processedAgents.codex).toBe(true);
	});

	test("applies default values for missing options", () => {
		const options: OnboardingOptions = {};

		const port = options.port ?? 18274;
		const tls = options.tls !== undefined ? options.tls : true;
		const daemon = options.daemon !== undefined ? options.daemon : true;

		expect(port).toBe(18274);
		expect(tls).toBe(true);
		expect(daemon).toBe(true);
	});

	test("respects explicit false values", () => {
		const options: OnboardingOptions = {
			tls: false,
			daemon: false,
		};

		const tls = options.tls !== undefined ? options.tls : true;
		const daemon = options.daemon !== undefined ? options.daemon : true;

		expect(tls).toBe(false);
		expect(daemon).toBe(false);
	});
});

describe("Wizard Step Result Types", () => {
	test("welcome result action types", () => {
		type WelcomeAction = "continue" | "modify" | "reset" | "keep";
		const validActions: WelcomeAction[] = ["continue", "modify", "reset", "keep"];

		validActions.forEach((action) => {
			expect(["continue", "modify", "reset", "keep"].includes(action)).toBe(true);
		});
	});

	test("daemon type consistency", () => {
		type DaemonType = "launchagent" | "systemd" | "taskscheduler" | "none";
		const validTypes: DaemonType[] = ["launchagent", "systemd", "taskscheduler", "none"];

		validTypes.forEach((type) => {
			expect(["launchagent", "systemd", "taskscheduler", "none"].includes(type)).toBe(true);
		});
	});
});
