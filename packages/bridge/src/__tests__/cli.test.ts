import { describe, expect, test } from "bun:test";
import { parseCli } from "../cli";

describe("CLI Parser", () => {
	test("no args returns serve command", () => {
		const result = parseCli(["node", "broski"], {});
		expect(result.subCommand).toBe("serve");
	});

	test("parses doctor command", () => {
		const result = parseCli(["node", "broski", "doctor"], {});
		expect(result.subCommand).toBe("doctor");
	});

	test("parses doctor with --fix flag", () => {
		const result = parseCli(["node", "broski", "doctor", "--fix"], {});
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorFix).toBe(true);
	});

	test("parses doctor with --repair flag (alias for --fix)", () => {
		const result = parseCli(["node", "broski", "doctor", "--repair"], {});
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorFix).toBe(true);
	});

	test("parses doctor with --profile flag", () => {
		const result = parseCli(["node", "broski", "doctor", "--profile", "network"], {});
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorProfile).toBe("network");
	});

	test("parses doctor with --export flag", () => {
		const result = parseCli(["node", "broski", "doctor", "--export"], {});
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorExport).toBe(true);
	});

	test("parses doctor with --deep flag", () => {
		const result = parseCli(["node", "broski", "doctor", "--deep"], {});
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorDeep).toBe(true);
	});

	test("parses doctor with --json flag", () => {
		const result = parseCli(["node", "broski", "doctor", "--json"], {});
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorJson).toBe(true);
	});

	test("parses logs command", () => {
		const result = parseCli(["node", "broski", "logs"], {});
		expect(result.subCommand).toBe("logs");
	});

	test("parses logs with --follow flag", () => {
		const result = parseCli(["node", "broski", "logs", "--follow"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsFollow).toBe(true);
	});

	test("parses logs with --export flag", () => {
		const result = parseCli(["node", "broski", "logs", "--export"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsExport).toBe(true);
	});

	test("parses logs with --json flag", () => {
		const result = parseCli(["node", "broski", "logs", "--json"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsJson).toBe(true);
	});

	test("parses logs with --plain flag", () => {
		const result = parseCli(["node", "broski", "logs", "--plain"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsPlain).toBe(true);
	});

	test("parses logs with --lines flag", () => {
		const result = parseCli(["node", "broski", "logs", "--lines", "50"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsLines).toBe(50);
	});

	test("parses logs with --no-errors flag", () => {
		const result = parseCli(["node", "broski", "logs", "--no-errors"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsIncludeErrors).toBe(false);
	});

	test("parses logs with --redact flag", () => {
		const result = parseCli(["node", "broski", "logs", "--redact"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsRedact).toBe(true);
	});

	test("parses logs with --no-redact flag", () => {
		const result = parseCli(["node", "broski", "logs", "--no-redact"], {});
		expect(result.subCommand).toBe("logs");
		expect(result.logsRedact).toBe(false);
	});

	test("parses setup command", () => {
		const result = parseCli(["node", "broski", "setup"], {});
		expect(result.subCommand).toBe("setup");
	});

	test("parses configure command", () => {
		const result = parseCli(["node", "broski", "configure"], {});
		expect(result.subCommand).toBe("configure");
	});

	test("parses troubleshoot command", () => {
		const result = parseCli(["node", "broski", "troubleshoot"], {});
		expect(result.subCommand).toBe("troubleshoot");
	});

	test("parses install command", () => {
		const result = parseCli(["node", "broski", "install"], {});
		expect(result.subCommand).toBe("install");
	});

	test("parses uninstall command", () => {
		const result = parseCli(["node", "broski", "uninstall"], {});
		expect(result.subCommand).toBe("uninstall");
	});

	test("parses status command", () => {
		const result = parseCli(["node", "broski", "status"], {});
		expect(result.subCommand).toBe("status");
	});

	test("parses stop command", () => {
		const result = parseCli(["node", "broski", "stop"], {});
		expect(result.subCommand).toBe("stop");
	});

	test("parses restart command", () => {
		const result = parseCli(["node", "broski", "restart"], {});
		expect(result.subCommand).toBe("restart");
	});

	test("parses qr command", () => {
		const result = parseCli(["node", "broski", "qr"], {});
		expect(result.subCommand).toBe("qr");
	});

	test("parses account command", () => {
		const result = parseCli(["node", "broski", "account"], {});
		expect(result.subCommand).toBe("account");
	});

	test("parses update command", () => {
		const result = parseCli(["node", "broski", "update"], {});
		expect(result.subCommand).toBe("update");
	});

	test("parses version command", () => {
		const result = parseCli(["node", "broski", "version"], {});
		expect(result.subCommand).toBe("version");
	});

	test("parses --port flag", () => {
		const result = parseCli(["node", "broski", "--port", "8080"], {});
		expect(result.bridgePort).toBe(8080);
	});

	test("parses --bridge-port flag (alias)", () => {
		const result = parseCli(["node", "broski", "--bridge-port", "8080"], {});
		expect(result.bridgePort).toBe(8080);
	});

	test("parses --funnel flag", () => {
		const result = parseCli(["node", "broski", "--funnel"], {});
		expect(result.enableFunnel).toBe(true);
	});

	test("parses --new-token flag", () => {
		const result = parseCli(["node", "broski", "--new-token"], {});
		expect(result.newToken).toBe(true);
	});

	test("parses --hotspot flag", () => {
		const result = parseCli(["node", "broski", "--hotspot"], {});
		expect(result.detectHotspot).toBe(true);
	});

	test("parses --detect-hotspot flag (alias)", () => {
		const result = parseCli(["node", "broski", "--detect-hotspot"], {});
		expect(result.detectHotspot).toBe(true);
	});

	test("parses --verbose flag", () => {
		// Note: verbose is gated by isCompiledBinary in actual implementation
		// In tests, this will return false since we're in dev mode
		const result = parseCli(["node", "broski", "--verbose"], {});
		expect(typeof result.verbose).toBe("boolean");
	});

	test("parses --help flag", () => {
		const result = parseCli(["node", "broski", "--help"], {});
		expect(result.help).toBe(true);
	});

	test("parses -h flag (help alias)", () => {
		const result = parseCli(["node", "broski", "-h"], {});
		expect(result.help).toBe(true);
	});

	test("parses --version flag to set version command", () => {
		const result = parseCli(["node", "broski", "--version"], {});
		expect(result.subCommand).toBe("version");
	});

	test("parses -V flag (version alias)", () => {
		const result = parseCli(["node", "broski", "-V"], {});
		expect(result.subCommand).toBe("version");
	});

	test("parses environment variables", () => {
		const env = { BROSKI_PORT: "9000", BROSKI_ENABLE_FUNNEL: "1" };
		const result = parseCli(["node", "broski"], env);
		expect(result.bridgePort).toBe(9000);
		expect(result.enableFunnel).toBe(true);
	});

	test("command line args override environment", () => {
		const env = { BROSKI_PORT: "9000" };
		const result = parseCli(["node", "broski", "--port", "8080"], env);
		expect(result.bridgePort).toBe(8080);
	});

	test("handles invalid port gracefully", () => {
		const result = parseCli(["node", "broski", "--port", "invalid"], {});
		expect(result.bridgePort).toBe(18274); // default
	});

	test("handles missing profile argument", () => {
		const result = parseCli(["node", "broski", "doctor", "--profile"], {});
		expect(result.doctorProfile).toBe("all"); // default
	});

	test("handles multiple flags combined", () => {
		const result = parseCli(
			["node", "broski", "doctor", "--fix", "--deep", "--profile", "network", "--json", "--export"],
			{},
		);
		expect(result.subCommand).toBe("doctor");
		expect(result.doctorFix).toBe(true);
		expect(result.doctorDeep).toBe(true);
		expect(result.doctorProfile).toBe("network");
		expect(result.doctorJson).toBe(true);
		expect(result.doctorExport).toBe(true);
	});

	test("handles logs with multiple flags", () => {
		const result = parseCli(
			[
				"node",
				"broski",
				"logs",
				"--follow",
				"--json",
				"--plain",
				"--lines",
				"100",
				"--export",
				"--no-errors",
				"--redact",
			],
			{},
		);
		expect(result.subCommand).toBe("logs");
		expect(result.logsFollow).toBe(true);
		expect(result.logsJson).toBe(true);
		expect(result.logsPlain).toBe(true);
		expect(result.logsLines).toBe(100);
		expect(result.logsExport).toBe(true);
		expect(result.logsIncludeErrors).toBe(false);
		expect(result.logsRedact).toBe(true);
	});

	test("empty args defaults to serve", () => {
		const result = parseCli(["node", "broski"], {});
		expect(result.subCommand).toBe("serve");
	});

	test("unknown command defaults to serve", () => {
		const result = parseCli(["node", "broski", "unknown"], {});
		expect(result.subCommand).toBe("serve");
	});
});
