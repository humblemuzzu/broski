import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../../config/defaults";
import { BroskiConfigSchema } from "../../../config/schema";

describe("claudeCode.terminalAsks", () => {
	test("is on by default, in the schema and in the defaults", () => {
		expect(BroskiConfigSchema.parse({ version: 1 }).claudeCode.terminalAsks).toBe(true);
		expect(getDefaultConfig().claudeCode.terminalAsks).toBe(true);
		expect(BroskiConfigSchema.parse(getDefaultConfig()).claudeCode).toEqual(getDefaultConfig().claudeCode);
	});

	test("an older config that names only the executable keeps it and gets the key on", () => {
		const parsed = BroskiConfigSchema.parse({ version: 1, claudeCode: { cliPath: "/opt/claude" } });
		expect(parsed.claudeCode).toEqual({ cliPath: "/opt/claude", terminalAsks: true });
	});

	test("false turns it off, and only a boolean is accepted", () => {
		expect(BroskiConfigSchema.parse({ version: 1, claudeCode: { terminalAsks: false } }).claudeCode.terminalAsks).toBe(
			false,
		);
		expect(BroskiConfigSchema.safeParse({ version: 1, claudeCode: { terminalAsks: "no" } }).success).toBe(false);
	});
});
