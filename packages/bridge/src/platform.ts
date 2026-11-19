/**
 * Platform abstraction layer for cross-platform Broski bridge.
 *
 * Every OS-specific difference is encapsulated here so that the rest of the
 * codebase can import clean, tested helpers instead of sprinkling
 * `process.platform` checks everywhere.
 *
 * Service install/uninstall/status lives in `platform/service/` (launchd);
 * this module only dispatches to it.
 *
 * The desktop host is macOS only.
 * Only imports from node: builtins, Bun globals and the platform/ helpers.
 */

import { chmodSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { isCompiledBinary } from "./compiled-binary";
import { runCommand } from "./platform/command";
import { defaultServiceHost } from "./platform/service/host";
import * as launchd from "./platform/service/launchd";
import type { DaemonConfig, DaemonStatus, DaemonType } from "./platform/service/types";

export type { DaemonConfig, DaemonStatus, DaemonType } from "./platform/service/types";

// ============================================================================
// 1. Platform Detection Constants
// ============================================================================

export const CURRENT_PLATFORM: NodeJS.Platform = process.platform;
export const IS_MACOS: boolean = CURRENT_PLATFORM === "darwin";

// ============================================================================
// 2. Binary/Command Discovery
// ============================================================================

/**
 * Find a binary on the current `process.env.PATH`. `Bun.which` alone reads the PATH the process started with,
 * which misses the login-shell PATH a service bridge imports at startup (`platform/shell-env.ts`).
 */
export function findBinary(name: string): string | null {
	try {
		const found = Bun.which(name, { PATH: process.env.PATH ?? "" });
		if (found) return found;
	} catch {
		// Bun.which may throw on some platforms
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

	const candidates = ["/usr/local/bin/bun", resolve(homedir(), ".bun/bin/bun"), "/opt/homebrew/bin/bun"];

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
	const lsof = runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
	return lsof.ok && lsof.stdout.includes("LISTEN");
}

/**
 * Get info about which process is using a port.
 */
export async function getProcessOnPort(port: number): Promise<{ pid: number; name: string } | null> {
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

	return null;
}

/**
 * Kill a process by PID.
 */
export function killProcess(pid: number): boolean {
	const res = runCommand("kill", ["-9", String(pid)]);
	return res.ok;
}

/**
 * Find processes matching a pattern.
 */
export function findProcessByPattern(pattern: string): number[] {
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
// macOS runs broski-link as a launchd agent; it spawns and restarts the bridge itself.
// ============================================================================

/**
 * Get the daemon type for the current platform.
 */
export function getDaemonType(): DaemonType {
	return IS_MACOS ? "launchagent" : "none";
}

/**
 * Get the path where the daemon config file lives.
 */
export function getDaemonConfigPath(): string | null {
	return IS_MACOS ? launchd.agentPlistPath(homedir()) : null;
}

/**
 * Install the daemon.
 */
export async function installDaemon(config: DaemonConfig): Promise<void> {
	await mkdir(config.logDir, { recursive: true });

	if (IS_MACOS) return launchd.install(defaultServiceHost(), config);
}

/**
 * Uninstall the daemon.
 */
export async function uninstallDaemon(): Promise<void> {
	if (IS_MACOS) return launchd.uninstall(defaultServiceHost());
}

/**
 * Get daemon status.
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
	if (IS_MACOS) return launchd.status(defaultServiceHost());

	return { installed: false, running: false, type: "none", configPath: null, pid: null };
}

/**
 * Stop the daemon.
 */
export async function stopDaemon(): Promise<void> {
	if (IS_MACOS) return launchd.stop(defaultServiceHost());
}

/**
 * Restart the daemon.
 */
export async function restartDaemon(): Promise<void> {
	if (IS_MACOS) return launchd.restart(defaultServiceHost());
}

// ============================================================================
// 5. TLS Certificate Generation
// ============================================================================

/**
 * Generate a self-signed TLS certificate by shelling out to openssl.
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

	await generateCertOpenssl(cn, days, opts.keyPath, opts.certPath);
}

/**
 * A terminal `claude` calling the permission hook refuses a certificate without the loopback name, and trusts this one
 * through `NODE_EXTRA_CA_CERTS`, so it is no CA: trusting it trusts nothing it could sign (`tls-loopback.ts`).
 */
const LOOPBACK_CERT_EXTENSIONS = [
	"-addext",
	"subjectAltName=IP:127.0.0.1,DNS:localhost",
	"-addext",
	"basicConstraints=critical,CA:FALSE",
];

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
			...LOOPBACK_CERT_EXTENSIONS,
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

// ============================================================================
// 6. Shell & Path Helpers
// ============================================================================

/**
 * The folders the phone may browse and start sessions in: the whole machine, home first so the phone opens there.
 * The bases are no boundary against the phone itself, which runs any command in a terminal; they keep a
 * request's path absolute, canonical and free of links that loop.
 */
export function getDefaultAllowedPaths(): string[] {
	return [homedir(), "/"];
}

// ============================================================================
// 7. User-Facing Messages (Platform-Appropriate)
// ============================================================================

/**
 * Get the command string to kill a process on a port (for error messages).
 */
export function getKillPortHint(port: number): string {
	return `kill -9 $(lsof -t -i:${port})`;
}

/**
 * Get the command to tail logs (for error messages).
 */
export function getTailLogsHint(): string {
	return `tail -f ${resolve(homedir(), ".broski", "logs", "bridge.log")}`;
}

/**
 * Get the sleep prevention tip for daemon mode.
 */
export function getSleepPreventionTip(): string {
	return 'Install Amphetamine (free on App Store) and disable "Allow system sleep when display is closed"';
}
