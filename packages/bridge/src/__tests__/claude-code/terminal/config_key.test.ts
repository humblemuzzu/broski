import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../../config/defaults";
import { BroskiConfigSchema } from "../../../config/schema";

describe("claudeCode.contract and claudeCode.terminalAsks", () => {
	test("the contract is off and terminal asks on by default, in the schema and in the defaults", () => {
		expect(BroskiConfigSchema.parse({ version: 1 }).claudeCode).toEqual({ contract: false, terminalAsks: true });
		expect(getDefaultConfig().claudeCode).toEqual({ contract: false, terminalAsks: true });
		expect(BroskiConfigSchema.parse(getDefaultConfig()).claudeCode).toEqual(getDefaultConfig().claudeCode);
	});

	test("an older config that names only the executable keeps it and gets both keys at their defaults", () => {
		const parsed = BroskiConfigSchema.parse({ version: 1, claudeCode: { cliPath: "/opt/claude" } });
		expect(parsed.claudeCode).toEqual({ cliPath: "/opt/claude", contract: false, terminalAsks: true });
	});

	test("each turns on or off, and only a boolean is accepted", () => {
		const on = BroskiConfigSchema.parse({ version: 1, claudeCode: { contract: true, terminalAsks: false } });
		expect(on.claudeCode).toEqual({ contract: true, terminalAsks: false });
		expect(BroskiConfigSchema.safeParse({ version: 1, claudeCode: { terminalAsks: "no" } }).success).toBe(false);
		expect(BroskiConfigSchema.safeParse({ version: 1, claudeCode: { contract: "yes" } }).success).toBe(false);
	});
});
