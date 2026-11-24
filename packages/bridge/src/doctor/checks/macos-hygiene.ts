import { readdir, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CheckResult } from "../types";

const RECENT_CRASH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SCREEN_SHARING_PORT = 5900;
const PROBE_TIMEOUT_MS = 1_500;

export interface MacosHygieneProbes {
	platform?: NodeJS.Platform;
	readCrashDialogType?: () => Promise<string | null>;
	suppressCrashDialogs?: () => Promise<boolean>;
	countRecentCrashes?: () => Promise<{ total: number; securityd: number }>;
	isScreenSharingListening?: () => Promise<boolean>;
	readFileVaultStatus?: () => Promise<"on" | "off" | "unknown">;
}

export async function runMacosHygieneChecks(probes: MacosHygieneProbes = {}): Promise<CheckResult[]> {
	const platform = probes.platform ?? process.platform;
	if (platform !== "darwin") {
		return [];
	}

	const [dialogType, crashes, screenSharing, fileVault] = await Promise.all([
		(probes.readCrashDialogType ?? readCrashDialogType)(),
		(probes.countRecentCrashes ?? countRecentCrashes)(),
		(probes.isScreenSharingListening ?? isScreenSharingListening)(),
		(probes.readFileVaultStatus ?? readFileVaultStatus)(),
	]);

	const results: CheckResult[] = [];

	results.push(buildCrashDialogCheck(dialogType, crashes.total, probes.suppressCrashDialogs ?? suppressCrashDialogs));
	results.push(buildKeychainHealthCheck(crashes.securityd));
	results.push(buildScreenSharingCheck(screenSharing));
	results.push(buildFileVaultCheck(fileVault));

	return results;
}

function buildCrashDialogCheck(
	dialogType: string | null,
	recentCrashes: number,
	fixFn: () => Promise<boolean>,
): CheckResult {
	const normalized = dialogType?.trim().toLowerCase() ?? "";
	const suppressed = normalized === "none" || normalized === "server";
	const crashNote = recentCrashes > 0 ? ` (${recentCrashes} crash report(s) in the last 7 days)` : "";
	if (suppressed) {
		return {
			id: "macos_crash_dialogs",
			category: "system",
			status: "ok",
			message: `macOS crash alert dialogs suppressed (DialogType=${normalized})${crashNote}`,
		};
	}
	return {
		id: "macos_crash_dialogs",
		category: "system",
		status: "warning",
		message: `macOS crash alert modals are enabled${crashNote} — unattended runs can stack Problem Reporter dialogs`,
		fix: "Run `defaults write com.apple.CrashReporter DialogType none` (reports still save to ~/Library/Logs/DiagnosticReports)",
		autoFix: fixFn,
	};
}

function buildKeychainHealthCheck(securitydCrashes: number): CheckResult {
	if (securitydCrashes > 0) {
		return {
			id: "macos_keychain_health",
			category: "security",
			status: "warning",
			message: `Detected ${securitydCrashes} recent securityd crash report(s) — this causes repeated macOS Keychain password prompt loops`,
			fix: "Unlock login keychain, grant codesign partition access, and disable auto-lock: `security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db` and `security set-keychain-settings ~/Library/Keychains/login.keychain-db`",
		};
	}
	return {
		id: "macos_keychain_health",
		category: "security",
		status: "ok",
		message: "No recent securityd crash reports detected",
		details: [
			"Tip for unattended builds: if codesign prompts for your password while away, run `security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db` and `security set-keychain-settings ~/Library/Keychains/login.keychain-db` once on this Mac.",
		],
	};
}

function buildScreenSharingCheck(listening: boolean): CheckResult {
	if (listening) {
		return {
			id: "macos_screen_sharing",
			category: "connectivity",
			status: "ok",
			message: "macOS Screen Sharing is listening on 127.0.0.1:5900 (Remote Screen ready)",
		};
	}
	return {
		id: "macos_screen_sharing",
		category: "connectivity",
		status: "info",
		message: "macOS Screen Sharing is off (only needed if you enable Experimental → Remote Mac Screen)",
		fix: "Enable System Settings → General → Sharing → Screen Sharing",
	};
}

function buildFileVaultCheck(status: "on" | "off" | "unknown"): CheckResult {
	if (status === "on") {
		return {
			id: "macos_filevault",
			category: "security",
			status: "info",
			message: "FileVault is On — sleep/lock unlocks remotely, but a full reboot requires physical unlock",
		};
	}
	if (status === "off") {
		return {
			id: "macos_filevault",
			category: "security",
			status: "info",
			message: "FileVault is Off — unattended reboots reach the login window without pre-boot unlock",
		};
	}
	return {
		id: "macos_filevault",
		category: "security",
		status: "info",
		message: "FileVault status unavailable",
	};
}

async function runTextCommand(cmd: string[]): Promise<{ ok: boolean; stdout: string }> {
	try {
		const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {}
		}, PROBE_TIMEOUT_MS);
		const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
		clearTimeout(timer);
		return { ok: code === 0, stdout };
	} catch {
		return { ok: false, stdout: "" };
	}
}

async function readCrashDialogType(): Promise<string | null> {
	const res = await runTextCommand(["defaults", "read", "com.apple.CrashReporter", "DialogType"]);
	return res.ok ? res.stdout.trim() : null;
}

async function suppressCrashDialogs(): Promise<boolean> {
	const res = await runTextCommand(["defaults", "write", "com.apple.CrashReporter", "DialogType", "none"]);
	return res.ok;
}

async function readFileVaultStatus(): Promise<"on" | "off" | "unknown"> {
	const res = await runTextCommand(["fdesetup", "status"]);
	if (!res.ok) return "unknown";
	const lower = res.stdout.toLowerCase();
	if (lower.includes("filevault is on")) return "on";
	if (lower.includes("filevault is off")) return "off";
	return "unknown";
}

async function countRecentCrashes(): Promise<{ total: number; securityd: number }> {
	const dirs = [join(homedir(), "Library", "Logs", "DiagnosticReports"), "/Library/Logs/DiagnosticReports"];
	const cutoff = Date.now() - RECENT_CRASH_WINDOW_MS;
	let total = 0;
	let securityd = 0;
	for (const dir of dirs) {
		try {
			const entries = await readdir(dir);
			for (const name of entries) {
				if (!name.endsWith(".ips") && !name.endsWith(".crash")) continue;
				try {
					const info = await stat(join(dir, name));
					if (info.mtimeMs < cutoff) continue;
					total += 1;
					if (name.toLowerCase().startsWith("securityd")) {
						securityd += 1;
					}
				} catch {}
			}
		} catch {}
	}
	return { total, securityd };
}

function isScreenSharingListening(): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port: SCREEN_SHARING_PORT });
		const done = (ok: boolean) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(500);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}
