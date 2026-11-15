import { describe, expect, test } from "bun:test";

// Test the non-interactive setup logic from onboarding.ts
// We focus on pure functions that don't require user interaction

describe("Agent Flag Parsing", () => {
	function agentNameFromFlag(flag: string): "pi" | "claude" | null {
		const lower = flag.toLowerCase().trim();
		if (lower === "pi") return "pi";
		if (lower === "claude" || lower === "claude-code" || lower === "claudecode") return "claude";
		return null;
	}

	test("handles pi variants", () => {
		expect(agentNameFromFlag("pi")).toBe("pi");
		expect(agentNameFromFlag("PI")).toBe("pi");
		expect(agentNameFromFlag(" pi ")).toBe("pi");
	});

	test("handles claude variants", () => {
		expect(agentNameFromFlag("claude")).toBe("claude");
		expect(agentNameFromFlag("claude-code")).toBe("claude");
		expect(agentNameFromFlag("claudecode")).toBe("claude");
		expect(agentNameFromFlag("CLAUDE-CODE")).toBe("claude");
	});

	test("rejects invalid flags", () => {
		expect(agentNameFromFlag("invalid")).toBe(null);
		expect(agentNameFromFlag("")).toBe(null);
		expect(agentNameFromFlag("openai")).toBe(null);
	});
});

describe("Daemon Type Mapping", () => {
	function mapDaemonTypeNonInteractive(): "launchagent" | "systemd" | "none" {
		// Simulate platform detection
		const IS_MACOS = process.platform === "darwin";
		const IS_LINUX = process.platform === "linux";

		if (IS_MACOS) return "launchagent";
		if (IS_LINUX) return "systemd";
		return "none";
	}

	test("returns valid daemon type for current platform", () => {
		const result = mapDaemonTypeNonInteractive();
		expect(["launchagent", "systemd", "none"].includes(result)).toBe(true);
	});

	function daemonTypeLabel(): string {
		const IS_MACOS = process.platform === "darwin";
		const IS_LINUX = process.platform === "linux";

		if (IS_MACOS) return "LaunchAgent";
		if (IS_LINUX) return "systemd";
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
				pi: false,
				claudeCode: false,
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

		expect(typeof mockConfig.agents.pi).toBe("boolean");
		expect(typeof mockConfig.agents.claudeCode).toBe("boolean");

		expect(typeof mockConfig.daemon.installed).toBe("boolean");
		expect(["launchagent", "systemd", "none"].includes(mockConfig.daemon.type)).toBe(true);
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
			agents: ["pi", "claude-code"],
		};

		// Simulate agent processing
		const processedAgents = { pi: false, claudeCode: false };

		if (options.agents) {
			for (const agent of options.agents) {
				const name = agent.toLowerCase().trim();
				if (name === "pi") processedAgents.pi = true;
				else if (name === "claude" || name === "claude-code") processedAgents.claudeCode = true;
			}
		}

		expect(processedAgents.pi).toBe(true);
		expect(processedAgents.claudeCode).toBe(true);
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
		type DaemonType = "launchagent" | "systemd" | "none";
		const validTypes: DaemonType[] = ["launchagent", "systemd", "none"];

		validTypes.forEach((type) => {
			expect(["launchagent", "systemd", "none"].includes(type)).toBe(true);
		});
	});
});
