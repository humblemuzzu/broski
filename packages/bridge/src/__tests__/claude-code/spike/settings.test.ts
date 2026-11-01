/**
 * Q8 (research/08-spike.md): `Query.updateSettings` through the CLI's own writer, against settings files
 * that already hold other keys, a `$schema`, an unusual key order and 4-space indentation.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClaudeHome } from "../../helpers/claude-home";
import { expectNoOrphans } from "./rig/orphans";
import { startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const MODEL = "claude-opus-5-5";
const SCHEMA = "https://json.schemastore.org/claude-code-settings.json";
const EXISTING = { $schema: SCHEMA, zeta: 1, permissions: { allow: ["Bash(ls)"] }, alpha: "keep" };

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

describe("Q8: updateSettings", () => {
	test(
		"localSettings outputStyle and userSettings effortLevel",
		async () => {
			const home = createClaudeHome();
			const local = join(home.projectDir, ".claude", "settings.local.json");
			const user = join(home.configDir, "settings.json");
			writeJson(local, EXISTING);
			writeJson(user, EXISTING);
			const spike = startSpike({ home, permissionMode: "default", turns: [{ text: ["ok"] }] });
			try {
				await spike.q.initializationResult();
				await spike.q.updateSettings("localSettings", { outputStyle: "Explanatory" });
				await spike.q.updateSettings("userSettings", { effortLevel: "high" });
				const refused = await spike.q.updateSettings("localSettings", { model: "opus" }).then(
					() => "accepted",
					(error: Error) => error.message,
				);
				const localText = readFileSync(local, "utf8");
				const userText = readFileSync(user, "utf8");
				expect(JSON.parse(localText)).toEqual({ ...EXISTING, outputStyle: "Explanatory" });
				expect(Object.keys(JSON.parse(localText))).toEqual(["$schema", "permissions", "zeta", "alpha", "outputStyle"]);
				expect(localText).toStartWith('{\n  "$schema"');
				expect(JSON.parse(userText)).toEqual({ ...EXISTING, modelSettings: { [MODEL]: { effortLevel: "high" } } });
				expect(refused).toBe("update_settings keys not allowed: model");
				expect(existsSync(join(home.projectDir, ".gitignore"))).toBe(false);
			} finally {
				await spike.close();
				home.cleanup();
			}
		},
		CLI_TEST_MS,
	);
});
