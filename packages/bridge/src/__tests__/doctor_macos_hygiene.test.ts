import { describe, expect, test } from "bun:test";
import { runMacosHygieneChecks } from "../doctor/checks/macos-hygiene";

describe("runMacosHygieneChecks", () => {
	test("returns empty on non-macOS platforms", async () => {
		const results = await runMacosHygieneChecks({ platform: "linux" });
		expect(results).toEqual([]);
	});

	test("warns when crash modals are enabled and securityd crashed recently", async () => {
		let fixed = false;
		const results = await runMacosHygieneChecks({
			platform: "darwin",
			readCrashDialogType: async () => null,
			suppressCrashDialogs: async () => {
				fixed = true;
				return true;
			},
			countRecentCrashes: async () => ({ total: 14, securityd: 3 }),
			isScreenSharingListening: async () => false,
			readFileVaultStatus: async () => "on",
		});

		const crash = results.find((r) => r.id === "macos_crash_dialogs");
		expect(crash?.status).toBe("warning");
		expect(crash?.message).toContain("14 crash report(s)");
		expect(await crash?.autoFix?.()).toBe(true);
		expect(fixed).toBe(true);

		const keychain = results.find((r) => r.id === "macos_keychain_health");
		expect(keychain?.status).toBe("warning");
		expect(keychain?.message).toContain("3 recent securityd crash");

		const screen = results.find((r) => r.id === "macos_screen_sharing");
		expect(screen?.status).toBe("info");
		expect(screen?.fix).toContain("Screen Sharing");

		const fv = results.find((r) => r.id === "macos_filevault");
		expect(fv?.status).toBe("info");
		expect(fv?.message).toContain("FileVault is On");
	});

	test("reports ok when crash dialogs are suppressed and Screen Sharing is listening", async () => {
		const results = await runMacosHygieneChecks({
			platform: "darwin",
			readCrashDialogType: async () => "none",
			countRecentCrashes: async () => ({ total: 0, securityd: 0 }),
			isScreenSharingListening: async () => true,
			readFileVaultStatus: async () => "off",
		});

		expect(results.find((r) => r.id === "macos_crash_dialogs")?.status).toBe("ok");
		expect(results.find((r) => r.id === "macos_keychain_health")?.status).toBe("ok");
		expect(results.find((r) => r.id === "macos_screen_sharing")?.status).toBe("ok");
		expect(results.find((r) => r.id === "macos_filevault")?.message).toContain("FileVault is Off");
	});
});
