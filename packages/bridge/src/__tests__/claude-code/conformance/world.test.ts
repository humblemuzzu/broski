/** The conformance world builds today, so Step 5 only removes the suite's skip; the rules themselves need the lanes. */

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { claudeCodeConformanceKit } from "./driver";
import { ELICIT_SERVER } from "./elicit-server";

test("a conformance world builds the adapter over a temp home and the scripted endpoint", async () => {
	const kit = claudeCodeConformanceKit(15_000);
	const { backend, driver } = await kit.factory({ catalog: { emit: () => undefined } });
	try {
		expect(backend.id).toBe("claude-code");
		expect(existsSync(join(driver.cwd, "README.md"))).toBe(true);
		expect(existsSync(join(driver.otherCwd, "README.md"))).toBe(true);
		expect(driver.cwd).not.toBe(driver.otherCwd);
		const config = await Bun.file(join(driver.cwd, "..", "home", ".claude", ".claude.json")).json();
		expect(Object.keys(config.mcpServers)).toEqual([ELICIT_SERVER]);
		expect(await driver.runExternally({ backend: "claude-code", sessionId: crypto.randomUUID() })).toBe(false);
	} finally {
		await backend.dispose();
		await kit.dispose();
	}
});
