import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BroskiConfig,
	BroskiConfigSchema,
	getConfigPath,
	getDefaultConfig,
	readConfig,
	updateConfig,
	writeConfig,
} from "../config";

const tempDirs: string[] = [];

/** Temp config path — config writes must never reach the user's real ~/.broski/config.json. */
function tempConfigPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-config-"));
	tempDirs.push(dir);
	return join(dir, "config.json");
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function readPersistedConfig(path: string): BroskiConfig {
	return JSON.parse(readFileSync(path, "utf-8")) as BroskiConfig;
}

describe("Config Schema", () => {
	test("BroskiConfigSchema validates correct config", () => {
		const validConfig = {
			version: 1,
			wizard: {
				completedSetup: true,
				lastRunAt: "2023-12-01T00:00:00Z",
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
				opencode: true,
				claudeCode: false,
				codex: false,
			},
			daemon: {
				installed: false,
				type: "none" as const,
			},
		};

		const result = BroskiConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	test("BroskiConfigSchema rejects invalid version", () => {
		const invalidConfig = {
			version: 2, // wrong version
			wizard: { completedSetup: false },
			network: {},
			security: {},
			agents: {},
			daemon: {},
		};

		const result = BroskiConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
	});

	test("BroskiConfigSchema fills in defaults", () => {
		const minimalConfig = {
			version: 1,
			// Provide empty objects to trigger individual field defaults
			wizard: {},
			network: {},
			security: {},
			agents: {},
			daemon: {},
		};

		const result = BroskiConfigSchema.safeParse(minimalConfig);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.wizard.completedSetup).toBe(false);
			expect(result.data.network.port).toBe(18274);
			expect(result.data.security.tls).toBe(true);
		}
	});

	test("BroskiConfigSchema coerces an out-of-range port without discarding the rest of the config", () => {
		const config = {
			...getDefaultConfig(),
			agents: { ...getDefaultConfig().agents, claudeCode: true },
			network: { ...getDefaultConfig().network, port: 70000 },
		};

		const result = BroskiConfigSchema.safeParse(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.network.port).toBe(18274);
			expect(result.data.agents.claudeCode).toBe(true);
		}
	});

	test("BroskiConfigSchema rejects invalid daemon type", () => {
		const invalidConfig = {
			version: 1,
			daemon: {
				type: "invalid-type",
			},
		};

		const result = BroskiConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
	});
});

describe("Default Config", () => {
	test("getDefaultConfig returns valid config", () => {
		const defaults = getDefaultConfig();
		const result = BroskiConfigSchema.safeParse(defaults);
		expect(result.success).toBe(true);
	});

	test("getDefaultConfig has expected defaults", () => {
		const defaults = getDefaultConfig();
		expect(defaults.version).toBe(1);
		expect(defaults.wizard.completedSetup).toBe(false);
		expect(defaults.network.port).toBe(18274);
		expect(defaults.security.tls).toBe(true);
		expect(defaults.agents.opencode).toBe(true);
		expect(defaults.agents.claudeCode).toBe(false);
		expect(defaults.agents.codex).toBe(false);
		expect(defaults.daemon.installed).toBe(false);
		expect(defaults.daemon.type).toBe("none");
	});

	test("getDefaultConfig returns fresh objects", () => {
		const config1 = getDefaultConfig();
		const config2 = getDefaultConfig();

		// Should be equivalent but different objects
		expect(config1).toEqual(config2);
		expect(config1).not.toBe(config2);
		expect(config1.wizard).not.toBe(config2.wizard);
		expect(config1.network).not.toBe(config2.network);
	});
});

describe("Config Path", () => {
	test("getConfigPath returns string", () => {
		const path = getConfigPath();
		expect(typeof path).toBe("string");
		expect(path.length).toBeGreaterThan(0);
		expect(path).toContain(".broski");
		expect(path).toContain("config.json");
	});
});

describe("Config Read/Write", () => {
	test("readConfig returns default config when file missing", async () => {
		const path = tempConfigPath();

		const defaults = await readConfig(path);

		expect(BroskiConfigSchema.safeParse(defaults).success).toBe(true);
		expect(defaults.network.port).toBe(18274);
	});

	test("writeConfig persists valid JSON", async () => {
		const path = tempConfigPath();
		const config = getDefaultConfig();
		config.network.port = 8080;

		await writeConfig(config, path);

		const persisted = readPersistedConfig(path);
		expect(persisted.network.port).toBe(8080);
		expect(BroskiConfigSchema.safeParse(persisted).success).toBe(true);

		const roundTripped = await readConfig(path);
		expect(roundTripped.network.port).toBe(8080);
	});
});

describe("Config Update", () => {
	test("updateConfig merges partial config", async () => {
		const path = tempConfigPath();
		await writeConfig(getDefaultConfig(), path);

		const partial: Partial<BroskiConfig> = {
			network: {
				port: 9090,
			},
		};

		const updated = await updateConfig(partial, path);
		expect(updated.network.port).toBe(9090);
		expect(updated.security.tls).toBe(true);

		expect(readPersistedConfig(path)).toEqual(updated);
	});

	test("config validation with all daemon types", () => {
		const types = ["launchagent", "systemd", "taskscheduler", "none"] as const;

		types.forEach((type) => {
			const config = {
				...getDefaultConfig(),
				daemon: {
					...getDefaultConfig().daemon,
					type,
				},
			};

			const result = BroskiConfigSchema.safeParse(config);
			expect(result.success).toBe(true);
		});
	});
});
