/**
 * Platform abstraction layer for cross-platform Broski bridge.
 *
 * Every OS-specific difference is encapsulated here so that the rest of the
 * codebase can import clean, tested helpers instead of sprinkling
 * `process.platform` checks everywhere.
 *
 * Service install/uninstall/status lives in `platform/service/` (launchd,
 * systemd); this module only dispatches to it.
 *
 * Supports: macOS (darwin), Linux (linux), Windows (win32).
 * Only imports from node: builtins, Bun globals and the platform/ helpers.
 */

import { chmodSync, existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { isCompiledBinary } from "./compiled-binary";
import { COMMAND_TIMEOUT_MS, runCommand } from "./platform/command";
import { defaultServiceHost } from "./platform/service/host";
import * as launchd from "./platform/service/launchd";
import { resolveLinkBinary } from "./platform/service/link-binary";
import * as systemd from "./platform/service/systemd";
import type { DaemonConfig, DaemonStatus, DaemonType } from "./platform/service/types";

export type { DaemonConfig, DaemonStatus, DaemonType } from "./platform/service/types";

// ============================================================================
// 1. Platform Detection Constants
// ============================================================================

export type Platform = "darwin" | "linux" | "win32";

export const CURRENT_PLATFORM: Platform = process.platform as Platform;
export const IS_MACOS: boolean = CURRENT_PLATFORM === "darwin";
export const IS_LINUX: boolean = CURRENT_PLATFORM === "linux";
export const IS_WINDOWS: boolean = CURRENT_PLATFORM === "win32";

// ============================================================================
// 2. Binary/Command Discovery
// ============================================================================

/**
 * Find a binary on the system. Cross-platform replacement for `which`.
 */
export function findBinary(name: string): string | null {
	try {
		const found = Bun.which(name);
		if (found) return found;
	} catch {
		// Bun.which may throw on some platforms
	}

	if (IS_WINDOWS) {
		// Check common Windows locations
		const ext = name.endsWith(".exe") ? "" : ".exe";
		const candidates = [
			resolve(process.env.USERPROFILE ?? homedir(), ".bun", "bin", `${name}${ext}`),
			`C:\\Program Files\\${name}\\${name}${ext}`,
			`C:\\Program Files (x86)\\${name}\\${name}${ext}`,
			resolve(process.env.LOCALAPPDATA ?? "", name, `${name}${ext}`),
		];
		for (const p of candidates) {
			try {
				if (existsSync(p)) return p;
			} catch {
				// continue
			}
		}
	}

	return null;
}

export { isCompiledBinary };

/**
 * Get the path to the Broski binary itself.
 * When compiled: process.execPath
 * When dev: bun + script path
 */
export function getBroskiBinaryPath(): string {
	if (isCompiledBinary()) {
		return process.execPath;
	}
	// Dev mode: return the script being run
	return process.argv[1] ?? process.execPath;
}

/**
 * Get the path to the Bun runtime (for dev mode / daemon config).
 */
export async function getBunPath(): Promise<string> {
	// Try Bun.which first
	try {
		const found = Bun.which("bun");
		if (found) {
			try {
				const s = await stat(found);
				if (s.isFile()) return found;
			} catch {
				/* continue */
			}
		}
	} catch {
		/* continue */
	}

	let candidates: string[];

	if (IS_MACOS) {
		candidates = ["/usr/local/bin/bun", resolve(homedir(), ".bun/bin/bun"), "/opt/homebrew/bin/bun"];
	} else if (IS_LINUX) {
		candidates = [
			"/usr/local/bin/bun",
			resolve(homedir(), ".bun/bin/bun"),
			"/usr/bin/bun",
			"/snap/bin/bun",
			resolve(homedir(), ".local/bin/bun"),
		];
	} else {
		// Windows
		const userProfile = process.env.USERPROFILE ?? homedir();
		const localAppData = process.env.LOCALAPPDATA ?? resolve(userProfile, "AppData", "Local");
		candidates = [
			resolve(userProfile, ".bun", "bin", "bun.exe"),
			"C:\\Program Files\\Bun\\bun.exe",
			resolve(localAppData, "bun", "bun.exe"),
		];
	}

	for (const loc of candidates) {
		try {
			const s = await stat(loc);
			if (s.isFile()) return loc;
		} catch {
			// continue
		}
	}

	return "bun"; // fallback — relies on PATH
}

// ============================================================================
// 3. Process Management
// ============================================================================

/**
 * Check if a TCP port is in use.
 */
export async function checkPortInUse(port: number): Promise<boolean> {
	if (IS_WINDOWS) {
		const res = runCommand("netstat", ["-ano"], { timeout: COMMAND_TIMEOUT_MS });
		if (!res.ok) return false;
		// Match lines with LISTENING state on the target port
		const lines = res.stdout.split("\n");
		for (const line of lines) {
			if (line.includes(`:${port}`) && /LISTENING/i.test(line)) return true;
		}
		return false;
	}

	// macOS/Linux: try lsof first
	const lsof = runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
	if (lsof.ok && lsof.stdout.includes("LISTEN")) return true;

	// Linux fallback: ss
	if (IS_LINUX) {
		const ss = runCommand("ss", ["-tlnp", `sport`, `=`, `:${port}`]);
		if (ss.ok && ss.stdout.includes(`:${port}`)) return true;
	}

	return false;
}

/**
 * Get info about which process is using a port.
 */
export async function getProcessOnPort(port: number): Promise<{ pid: number; name: string } | null> {
	if (IS_WINDOWS) {
		const res = runCommand("netstat", ["-ano"], { timeout: COMMAND_TIMEOUT_MS });
		if (!res.ok) return null;

		for (const line of res.stdout.split("\n")) {
			if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
				const parts = line.trim().split(/\s+/);
				const pidStr = parts[parts.length - 1];
				const pid = Number(pidStr);
				if (!Number.isFinite(pid) || pid <= 0) continue;

				// Get process name via tasklist
				const tl = runCommand("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"]);
				let name = `PID ${pid}`;
				if (tl.ok && tl.stdout) {
					const match = tl.stdout.match(/"([^"]+)"/);
					if (match) name = match[1]!;
				}
				return { pid, name };
			}
		}
		return null;
	}

	// macOS/Linux: lsof
	const lsof = runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
	if (lsof.ok && lsof.stdout) {
		const lines = lsof.stdout.split("\n");
		for (const line of lines.slice(1)) {
			// skip header
			const parts = line.split(/\s+/);
			if (parts.length >= 2) {
				const name = parts[0] ?? "";
				const pid = Number(parts[1]);
				if (Number.isFinite(pid) && pid > 0) return { pid, name };
			}
		}
	}

	// Linux fallback: ss
	if (IS_LINUX) {
		const ss = runCommand("ss", ["-tlnp", "sport", "=", `:${port}`]);
		if (ss.ok && ss.stdout) {
			// ss output format includes pid=NNNN
			const pidMatch = ss.stdout.match(/pid=(\d+)/);
			if (pidMatch) {
				const pid = Number(pidMatch[1]);
				return { pid, name: `PID ${pid}` };
			}
		}
	}

	return null;
}

/**
 * Kill a process by PID.
 */
export function killProcess(pid: number): boolean {
	if (IS_WINDOWS) {
		const res = runCommand("taskkill", ["/F", "/PID", String(pid)]);
		return res.ok;
	}

	const res = runCommand("kill", ["-9", String(pid)]);
	return res.ok;
}

/**
 * Find processes matching a pattern.
 */
export function findProcessByPattern(pattern: string): number[] {
	if (IS_WINDOWS) {
		const res = runCommand("tasklist", ["/FO", "CSV", "/NH"]);
		if (!res.ok) return [];

		const pids: number[] = [];
		for (const line of res.stdout.split("\n")) {
			if (!line.trim()) continue;
			// CSV format: "name.exe","PID","Session Name","Session#","Mem Usage"
			const match = line.match(/"([^"]+)","(\d+)"/);
			if (match) {
				const name = match[1];
				const pid = Number(match[2]);
				if (name?.toLowerCase().includes(pattern.toLowerCase()) && Number.isFinite(pid) && pid > 0) {
					pids.push(pid);
				}
			}
		}
		return pids;
	}

	// macOS/Linux: pgrep
	const res = runCommand("pgrep", ["-f", pattern]);
	if (!res.ok || !res.stdout) return [];

	return res.stdout
		.split("\n")
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isFinite(n) && n > 0 && n !== process.pid);
}

// ============================================================================
// 4. Daemon/Service Management
//
// macOS and Linux run broski-link, which spawns and restarts the bridge itself.
// Windows has no broski-link (unix sockets) and stays on the Task Scheduler.
// ============================================================================

// Daemon identifiers
const WINDOWS_TASK = "BroskiBridge";

/**
 * Get the daemon type for the current platform.
 */
export function getDaemonType(): DaemonType {
	if (IS_MACOS) return "launchagent";
	if (IS_LINUX) return "systemd";
	if (IS_WINDOWS) return "task-scheduler";
	return "none";
}

/**
 * Get the path where the daemon config file lives.
 */
export function getDaemonConfigPath(): string {
	if (IS_MACOS) return launchd.agentPlistPath(homedir());
	if (IS_LINUX) return systemd.unitPath(homedir());
	// Windows: no file, return a label
	return WINDOWS_TASK;
}

/**
 * Generate the daemon config content.
 * macOS: plist XML, Linux: systemd unit, Windows: null (uses schtasks).
 */
export function generateDaemonConfig(config: DaemonConfig): string | null {
	if (IS_MACOS) return launchd.generatePlist(config, resolveLinkBinaryPath(config), homedir());
	if (IS_LINUX) return systemd.generateUnit(config, resolveLinkBinaryPath(config));
	// Windows uses schtasks commands, not a config file
	return null;
}

function resolveLinkBinaryPath(config: DaemonConfig): string {
	return resolveLinkBinary({ broskiBinaryPath: config.binaryPath, override: config.linkBinaryPath });
}

/**
 * Install the daemon.
 */
export async function installDaemon(config: DaemonConfig): Promise<void> {
	// Ensure log directory exists
	await mkdir(config.logDir, { recursive: true });

	if (IS_MACOS) return launchd.install(defaultServiceHost(), config);
	if (IS_LINUX) return systemd.install(defaultServiceHost(), config);
	if (IS_WINDOWS) await installWindowsDaemon(config);
}

async function installWindowsDaemon(config: DaemonConfig): Promise<void> {
	const execStr = [config.binaryPath, ...config.args].join(" ");

	const res = runCommand("schtasks", [
		"/create",
		"/tn",
		WINDOWS_TASK,
		"/tr",
		execStr,
		"/sc",
		"onlogon",
		"/rl",
		"LIMITED",
		"/f",
	]);

	if (!res.ok) {
		throw new Error(`Failed to create scheduled task: ${res.stderr || res.stdout}`);
	}

	// Start the task immediately too
	runCommand("schtasks", ["/run", "/tn", WINDOWS_TASK]);
}

/**
 * Uninstall the daemon.
 */
export async function uninstallDaemon(): Promise<void> {
	if (IS_MACOS) return launchd.uninstall(defaultServiceHost());
	if (IS_LINUX) return systemd.uninstall(defaultServiceHost());
	if (IS_WINDOWS) await uninstallWindowsDaemon();
}

async function uninstallWindowsDaemon(): Promise<void> {
	// End the running task first
	runCommand("schtasks", ["/end", "/tn", WINDOWS_TASK]);

	// Delete the task
	const res = runCommand("schtasks", ["/delete", "/tn", WINDOWS_TASK, "/f"]);
	if (!res.ok) {
		// Not an error if it didn't exist
	}
}

/**
 * Get daemon status.
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
	if (IS_MACOS) return launchd.status(defaultServiceHost());
	if (IS_LINUX) return systemd.status(defaultServiceHost());
	if (IS_WINDOWS) return getWindowsDaemonStatus();

	return { installed: false, running: false, type: "none", configPath: null, pid: null };
}

async function getWindowsDaemonStatus(): Promise<DaemonStatus> {
	const type: DaemonType = "task-scheduler";
	const configPath = WINDOWS_TASK;

	const res = runCommand("schtasks", ["/query", "/tn", WINDOWS_TASK, "/fo", "csv", "/nh"]);
	if (!res.ok || !res.stdout.trim()) {
		return { installed: false, running: false, type, configPath, pid: null };
	}

	const running = /Running/i.test(res.stdout);

	// Windows Task Scheduler doesn't directly expose PID in query output.
	// Attempt to find the process via pattern match.
	let pid: number | null = null;
	if (running) {
		const pids = findProcessByPattern("broski");
		if (pids.length > 0) pid = pids[0] ?? null;
	}

	return { installed: true, running, type, configPath, pid };
}

/**
 * Stop the daemon.
 */
export async function stopDaemon(): Promise<void> {
	if (IS_MACOS) return launchd.stop(defaultServiceHost());
	if (IS_LINUX) return systemd.stop(defaultServiceHost());
	if (IS_WINDOWS) runCommand("schtasks", ["/end", "/tn", WINDOWS_TASK]);
}

/**
 * Restart the daemon.
 */
export async function restartDaemon(): Promise<void> {
	if (IS_MACOS) return launchd.restart(defaultServiceHost());
	if (IS_LINUX) return systemd.restart(defaultServiceHost());
	if (IS_WINDOWS) {
		runCommand("schtasks", ["/end", "/tn", WINDOWS_TASK]);
		await Bun.sleep(1000);
		runCommand("schtasks", ["/run", "/tn", WINDOWS_TASK]);
	}
}

// ============================================================================
// 5. TLS Certificate Generation
// ============================================================================

export interface CertificateResult {
	keyPem: string;
	certPem: string;
}

/**
 * Generate a self-signed TLS certificate.
 *
 * - macOS/Linux: shells out to openssl (always available on these platforms).
 * - Windows: uses PowerShell's New-SelfSignedCertificate, then exports to PEM.
 *   Falls back to openssl if available on Windows PATH.
 */
export async function generateSelfSignedCertificate(opts: {
	commonName?: string;
	validityDays?: number;
	keyPath: string;
	certPath: string;
}): Promise<void> {
	const cn = opts.commonName ?? "broski";
	const days = opts.validityDays ?? 365;

	// Ensure parent directories exist
	await mkdir(dirname(opts.keyPath), { recursive: true });
	await mkdir(dirname(opts.certPath), { recursive: true });

	if (IS_MACOS || IS_LINUX) {
		await generateCertOpenssl(cn, days, opts.keyPath, opts.certPath);
	} else {
		// Windows: try openssl first, fall back to PowerShell
		const openssl = findBinary("openssl");
		if (openssl) {
			await generateCertOpenssl(cn, days, opts.keyPath, opts.certPath);
		} else {
			await generateCertPowerShell(cn, days, opts.keyPath, opts.certPath);
		}
	}
}

async function generateCertOpenssl(cn: string, days: number, keyPath: string, certPath: string): Promise<void> {
	const openssl = findBinary("openssl") ?? "openssl";

	const res = runCommand(
		openssl,
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-subj",
			`/CN=${cn}`,
			"-days",
			String(days),
			"-keyout",
			keyPath,
			"-out",
			certPath,
		],
		{ timeout: 15000 },
	);

	if (!res.ok) {
		throw new Error(`Failed to generate TLS cert via OpenSSL: ${res.stderr || res.stdout || "unknown error"}`);
	}

	// Tighten key permissions (best-effort)
	try {
		chmodSync(keyPath, 0o600);
	} catch {
		/* ignore */
	}
	try {
		chmodSync(certPath, 0o644);
	} catch {
		/* ignore */
	}
}

async function generateCertPowerShell(cn: string, days: number, keyPath: string, certPath: string): Promise<void> {
	// Build PowerShell script to create a self-signed certificate and export to PEM.
	// We use string concatenation to avoid backtick/dollar conflicts with JS template literals.
	const certPathEscaped = certPath.replace(/\\/g, "\\\\");
	const keyPathEscaped = keyPath.replace(/\\/g, "\\\\");
	const crlf = "`r`n"; // PowerShell escape for \r\n
	const lines = [
		"$ErrorActionPreference = 'Stop'",
		'$cert = New-SelfSignedCertificate -Subject "CN=' +
			cn +
			'" -CertStoreLocation "Cert:\\CurrentUser\\My" -NotAfter (Get-Date).AddDays(' +
			days +
			") -KeyExportPolicy Exportable -KeySpec Signature -KeyLength 2048 -Type SSLServerAuthentication",
		"$thumbprint = $cert.Thumbprint",
		"",
		"$certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)",
		`$certPem = "-----BEGIN CERTIFICATE-----${crlf}"`,
		"$certPem += [Convert]::ToBase64String($certBytes, [Base64FormattingOptions]::InsertLineBreaks)",
		`$certPem += "${crlf}-----END CERTIFICATE-----"`,
		`[System.IO.File]::WriteAllText("${certPathEscaped}", $certPem)`,
		"",
		"$key = $cert.PrivateKey",
		"$keyBytes = $key.ExportRSAPrivateKey()",
		`$keyPem = "-----BEGIN RSA PRIVATE KEY-----${crlf}"`,
		"$keyPem += [Convert]::ToBase64String($keyBytes, [Base64FormattingOptions]::InsertLineBreaks)",
		`$keyPem += "${crlf}-----END RSA PRIVATE KEY-----"`,
		`[System.IO.File]::WriteAllText("${keyPathEscaped}", $keyPem)`,
		"",
		'Remove-Item "Cert:\\CurrentUser\\My\\$thumbprint" -ErrorAction SilentlyContinue',
	];
	const psScript = lines.join("\n");

	const res = runCommand("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
		timeout: 30000,
	});

	if (!res.ok) {
		throw new Error(`Failed to generate TLS cert via PowerShell: ${res.stderr || res.stdout || "unknown error"}`);
	}
}

// ============================================================================
// 6. Shell & Path Helpers
// ============================================================================

/**
 * Get the null device path.
 */
export function getNullDevice(): string {
	return IS_WINDOWS ? "NUL" : "/dev/null";
}

/**
 * Get temp directory.
 */
export function getTmpDir(): string {
	return tmpdir();
}

/**
 * Get safe default allowed base paths for file operations.
 */
export function getDefaultAllowedPaths(): string[] {
	if (IS_WINDOWS) {
		return [homedir(), tmpdir()];
	}
	return [homedir(), "/tmp", "/var/tmp"];
}

// ============================================================================
// 7. User-Facing Messages (Platform-Appropriate)
// ============================================================================

/**
 * Get the command string to kill a process on a port (for error messages).
 */
export function getKillPortHint(port: number): string {
	if (IS_MACOS) {
		return `kill -9 $(lsof -t -i:${port})`;
	}
	if (IS_LINUX) {
		return `kill -9 $(lsof -t -i:${port})  # or: fuser -k ${port}/tcp`;
	}
	// Windows
	return `netstat -ano | findstr :${port}\ntaskkill /F /PID <pid>`;
}

/**
 * Get the command to tail logs (for error messages).
 */
export function getTailLogsHint(): string {
	const logPath = resolve(homedir(), ".broski", "logs", "bridge.log");
	if (IS_WINDOWS) {
		return `Get-Content -Wait "${logPath}"`;
	}
	return `tail -f ${logPath}`;
}

/**
 * Get the sleep prevention tip for daemon mode.
 */
export function getSleepPreventionTip(): string {
	if (IS_MACOS) {
		return 'Install Amphetamine (free on App Store) and disable "Allow system sleep when display is closed"';
	}
	if (IS_LINUX) {
		return "Adjust sleep settings: sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target";
	}
	// Windows
	return "Adjust power settings: powercfg /change standby-timeout-ac 0";
}
