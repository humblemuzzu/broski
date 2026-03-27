import { describe, expect, test } from "bun:test";
import { parseCli } from "../cli";
import { runSystemChecks } from "../doctor/checks/system";
import { createDoctorContext } from "../doctor/context";
import { redactSensitiveText } from "../logging/redact";

describe("System Integration Tests", () => {
	test("CLI parser integrates with doctor options", () => {
		const result = parseCli(["node", "broski", "doctor", "--fix", "--json"], {});
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorFix).toBe(true);
		expect(result.doctorJson).toBe(true);
	});

	test("Doctor system can create context and run checks", async () => {
		const ctx = await createDoctorContext();
		const results = await runSystemChecks(ctx);

		expect(ctx).toBeDefined();
		expect(ctx.port).toBeGreaterThan(0);
		expect(Array.isArray(results)).toBe(true);
		expect(results.length).toBeGreaterThan(0);

		// All results should have required fields
		for (const result of results) {
			expect(typeof result.id).toBe("string");
			expect(typeof result.category).toBe("string");
			expect(typeof result.status).toBe("string");
			expect(typeof result.message).toBe("string");
		}
	});

	test("Logging system properly redacts sensitive data", () => {
		const testCases = [
			{
				input: "API_KEY=sk-ant-abc123def456",
				shouldNotContain: "abc123def456",
				shouldContain: "sk-ant…f456",
			},
			{
				input: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
				shouldNotContain: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
				shouldContain: "eyJhbG…test",
			},
			{
				input: "PASSWORD=secret123",
				shouldNotContain: "secret123",
				shouldContain: "***",
			},
		];

		for (const testCase of testCases) {
			const redacted = redactSensitiveText(testCase.input);
			expect(redacted).not.toContain(testCase.shouldNotContain);
			expect(redacted).toContain(testCase.shouldContain);
		}
	});

	test("CLI parser handles complex argument combinations", () => {
		const result = parseCli(
			["node", "broski", "logs", "--follow", "--json", "--lines", "100", "--redact", "--export"],
			{},
		);

		expect(result.subCommand).toBe("logs");
		expect(result.logsFollow).toBe(true);
		expect(result.logsJson).toBe(true);
		expect(result.logsLines).toBe(100);
		expect(result.logsRedact).toBe(true);
		expect(result.logsExport).toBe(true);
	});

	test("System shows healthy status for basic functionality", async () => {
		// Test that the core systems can initialize without crashing
		const ctx = await createDoctorContext();
		expect(ctx.config).toBeDefined();
		expect(ctx.paths.home).toContain(".broski");

		// Test CLI parsing works
		const cli = parseCli(["node", "broski", "doctor"], {});
		expect(cli.subCommand).toBe("doctor");

		// Test redaction works
		const redacted = redactSensitiveText("API_KEY=secret123");
		expect(redacted).not.toBe("API_KEY=secret123");
	});

	test("Error handling works correctly", () => {
		// Test CLI with invalid port
		const result = parseCli(["node", "broski", "--port", "invalid"], {});
		expect(result.bridgePort).toBe(18274); // should fall back to default

		// Test redaction with null/undefined
		expect(redactSensitiveText("")).toBe("");
		expect(redactSensitiveText(null as any)).toBeNull();
		expect(redactSensitiveText(undefined as any)).toBeUndefined();
	});
});
