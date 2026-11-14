import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../../config/defaults";
import { BroskiConfigSchema } from "../../../config/schema";

describe("claudeCode.terminalAsks", () => {
	test("terminal asks are on by default, in the schema and in the defaults", () => {
		expect(BroskiConfigSchema.parse({ version: 1 }).claudeCode).toEqual({ terminalAsks: true });
		expect(getDefaultConfig().claudeCode).toEqual({ terminalAsks: true });
		expect(BroskiConfigSchema.parse(getDefaultConfig()).claudeCode).toEqual(getDefaultConfig().claudeCode);
	});

	test("a config that names only the executable keeps it and gets terminal asks at the default", () => {
		const parsed = BroskiConfigSchema.parse({ version: 1, claudeCode: { cliPath: "/opt/claude" } });
		expect(parsed.claudeCode).toEqual({ cliPath: "/opt/claude", terminalAsks: true });
	});

	test("it turns off, and only a boolean is accepted", () => {
		const off = BroskiConfigSchema.parse({ version: 1, claudeCode: { terminalAsks: false } });
		expect(off.claudeCode).toEqual({ terminalAsks: false });
		expect(BroskiConfigSchema.safeParse({ version: 1, claudeCode: { terminalAsks: "no" } }).success).toBe(false);
	});
});
