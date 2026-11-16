import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describeFailure } from "../command";
import { resolveLinkBinary } from "./link-binary";
import type { DaemonConfig, DaemonStatus, ServiceHost } from "./types";

export const SYSTEMD_UNIT = "broski-link";
export const LEGACY_SYSTEMD_UNIT = "broski-bridge";

const LOG_FILE_NAME = "link.log";

export function unitPath(home: string): string {
	return resolve(home, ".config", "systemd", "user", `${SYSTEMD_UNIT}.service`);
}

export function legacyUnitPath(home: string): string {
	return resolve(home, ".config", "systemd", "user", `${LEGACY_SYSTEMD_UNIT}.service`);
}

/**
 * ExecStart runs broski-link, which spawns and restarts the bridge itself. `KillMode=process`: a stop or restart
 * signals broski-link alone, which ends its bridge; the default `control-group` would also kill the holders of hosted
 * Pi sessions (`backends/pi/holder/`), which exist to outlive both, and which `broski stop` and `uninstall` end.
 */
export function generateUnit(config: DaemonConfig, linkBinaryPath: string): string {
	const execStart = [linkBinaryPath, "run", "--bridge-cmd", config.binaryPath, ...config.args]
		.map(quoteExecArg)
		.join(" ");
	const logFile = resolve(config.logDir, LOG_FILE_NAME);

	return `[Unit]
Description=Broski Link (supervises the Broski bridge)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
KillMode=process
Environment=HOME=%h
Environment=PATH=/usr/local/bin:/usr/bin:/bin:%h/.local/bin:%h/.bun/bin

StandardOutput=append:${logFile}
StandardError=append:${logFile}

[Install]
WantedBy=default.target`;
}

export async function install(host: ServiceHost, config: DaemonConfig): Promise<void> {
	const linkBinaryPath = resolveLinkBinary({
		broskiBinaryPath: config.binaryPath,
		override: config.linkBinaryPath,
	});
	const path = unitPath(host.home);

	await mkdir(dirname(path), { recursive: true });
	await removeLegacyUnit(host);
	await writeFile(path, generateUnit(config, linkBinaryPath), { mode: 0o644 });

	host.run("systemctl", ["--user", "daemon-reload"]);
	const res = host.run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
	if (!res.ok) throw new Error(`Failed to enable ${SYSTEMD_UNIT}.service: ${describeFailure(res)}`);

	ensureLinger(host);
}

export async function uninstall(host: ServiceHost): Promise<void> {
	await removeLegacyUnit(host);

	host.run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
	try {
		await unlink(unitPath(host.home));
	} catch {
		// Already gone.
	}
	host.run("systemctl", ["--user", "daemon-reload"]);
}

export async function status(host: ServiceHost): Promise<DaemonStatus> {
	const configPath = unitPath(host.home);
	if (!existsSync(configPath)) {
		return { installed: false, running: false, type: "systemd", configPath, pid: null };
	}

	const res = host.run("systemctl", ["--user", "is-active", SYSTEMD_UNIT]);
	const running = res.ok && res.stdout.trim() === "active";
	return { installed: true, running, type: "systemd", configPath, pid: running ? mainPid(host) : null };
}

export async function stop(host: ServiceHost): Promise<void> {
	host.run("systemctl", ["--user", "stop", SYSTEMD_UNIT]);
}

export async function restart(host: ServiceHost): Promise<void> {
	host.run("systemctl", ["--user", "restart", SYSTEMD_UNIT]);
}

async function removeLegacyUnit(host: ServiceHost): Promise<void> {
	const legacyPath = legacyUnitPath(host.home);
	if (!existsSync(legacyPath)) return;

	host.run("systemctl", ["--user", "disable", "--now", LEGACY_SYSTEMD_UNIT]);
	try {
		await unlink(legacyPath);
	} catch {
		// Already gone.
	}
}

/**
 * Without linger a user service dies at logout. Enabling it needs polkit or
 * sudo, so a failure is reported with the exact command and installation
 * continues.
 */
function ensureLinger(host: ServiceHost): void {
	const show = host.run("loginctl", ["show-user", host.user, "-p", "Linger"]);
	if (!show.ok || !show.stdout.includes("Linger=no")) return;

	if (host.run("loginctl", ["enable-linger", host.user]).ok) return;
	console.log(`   Run this to keep Broski Link running after logout: sudo loginctl enable-linger ${host.user}`);
}

function mainPid(host: ServiceHost): number | null {
	const res = host.run("systemctl", ["--user", "show", SYSTEMD_UNIT, "-p", "MainPID"]);
	const match = res.ok ? res.stdout.match(/MainPID=(\d+)/) : null;
	const pid = match ? Number(match[1]) : Number.NaN;
	return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function quoteExecArg(arg: string): string {
	return /[\s"'\\]/.test(arg) ? `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : arg;
}
