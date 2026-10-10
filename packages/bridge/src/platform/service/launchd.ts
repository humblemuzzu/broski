import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describeFailure, type RunResult } from "../command";
import { resolveLinkBinary } from "./link-binary";
import type { DaemonConfig, DaemonStatus, ServiceHost } from "./types";

export const LAUNCHD_LABEL = "com.broski.link";
export const LEGACY_LAUNCHD_LABEL = "com.broski.bridge";

const LOG_FILE_NAME = "link.log";

export function agentPlistPath(home: string): string {
	return resolve(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function legacyAgentPlistPath(home: string): string {
	return resolve(home, "Library", "LaunchAgents", `${LEGACY_LAUNCHD_LABEL}.plist`);
}

/**
 * ProgramArguments: broski-link owns the bridge process, so the plist starts the
 * link daemon and hands it the bridge command instead of the bridge itself.
 */
export function generatePlist(config: DaemonConfig, linkBinaryPath: string, home: string): string {
	const logFile = resolve(config.logDir, LOG_FILE_NAME);
	const programArgs = [linkBinaryPath, "run", "--bridge-cmd", config.binaryPath, ...config.args];

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${xmlArray(programArgs)}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${escapeXml(logFile)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logFile)}</string>
    <key>WorkingDirectory</key>
    <string>${escapeXml(config.workDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escapeXml(runtimePath(config.binaryPath, home))}</string>
        <key>HOME</key>
        <string>${escapeXml(home)}</string>
    </dict>
</dict>
</plist>`;
}

function xmlArray(values: string[]): string {
	return values.map((value) => `        <string>${escapeXml(value)}</string>`).join("\n");
}

function runtimePath(binaryPath: string, home: string): string {
	return [
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/opt/homebrew/bin",
		dirname(binaryPath),
		`${home}/.opencode/bin`,
		`${home}/.local/bin`,
		`${home}/.npm-global/bin`,
		`${home}/.bun/bin`,
	].join(":");
}

export async function install(host: ServiceHost, config: DaemonConfig): Promise<void> {
	const linkBinaryPath = resolveLinkBinary({
		broskiBinaryPath: config.binaryPath,
		override: config.linkBinaryPath,
	});
	const plistPath = agentPlistPath(host.home);

	await mkdir(dirname(plistPath), { recursive: true });
	await removeLegacyAgent(host);
	if (existsSync(plistPath)) bootoutJob(host, LAUNCHD_LABEL, plistPath);

	await writeFile(plistPath, generatePlist(config, linkBinaryPath, host.home), { mode: 0o644 });
	await bootstrapJob(host, plistPath);
}

export async function uninstall(host: ServiceHost): Promise<void> {
	await removeLegacyAgent(host);

	const plistPath = agentPlistPath(host.home);
	if (existsSync(plistPath)) bootoutJob(host, LAUNCHD_LABEL, plistPath);
	try {
		await unlink(plistPath);
	} catch {
		// Already gone.
	}
}

export async function status(host: ServiceHost): Promise<DaemonStatus> {
	const configPath = agentPlistPath(host.home);
	if (!existsSync(configPath)) {
		return { installed: false, running: false, type: "launchagent", configPath, pid: null };
	}

	const res = host.run("launchctl", ["list", LAUNCHD_LABEL]);
	const running = res.ok && res.stdout.includes(LAUNCHD_LABEL);
	return { installed: true, running, type: "launchagent", configPath, pid: running ? parseListPid(res.stdout) : null };
}

export async function stop(host: ServiceHost): Promise<void> {
	if (host.run("launchctl", ["kill", "SIGTERM", jobTarget(host, LAUNCHD_LABEL)]).ok) return;
	host.run("launchctl", ["stop", LAUNCHD_LABEL]);
}

export async function restart(host: ServiceHost): Promise<void> {
	if (host.run("launchctl", ["kickstart", "-k", jobTarget(host, LAUNCHD_LABEL)]).ok) return;

	const plistPath = agentPlistPath(host.home);
	bootoutJob(host, LAUNCHD_LABEL, plistPath);
	try {
		await bootstrapJob(host, plistPath);
	} catch (err) {
		console.warn(`  ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function removeLegacyAgent(host: ServiceHost): Promise<void> {
	const legacyPath = legacyAgentPlistPath(host.home);
	if (!existsSync(legacyPath)) return;

	bootoutJob(host, LEGACY_LAUNCHD_LABEL, legacyPath);
	try {
		await unlink(legacyPath);
	} catch {
		// Already gone.
	}
}

async function bootstrapJob(host: ServiceHost, plistPath: string): Promise<void> {
	const res = host.run("launchctl", ["bootstrap", `gui/${host.uid}`, plistPath]);
	if (res.ok) return;

	if (isUnsupportedSubcommand(res)) {
		const legacy = host.run("launchctl", ["load", plistPath]);
		if (legacy.ok) return;
		throw new Error(`Failed to load LaunchAgent ${plistPath}: ${describeFailure(legacy)}`);
	}
	throw new Error(`Failed to start LaunchAgent: ${describeFailure(res)}`);
}

function bootoutJob(host: ServiceHost, label: string, plistPath: string): void {
	if (host.run("launchctl", ["bootout", jobTarget(host, label)]).ok) return;
	if (host.run("launchctl", ["bootout", `gui/${host.uid}`, plistPath]).ok) return;
	host.run("launchctl", ["unload", plistPath]);
}

function isUnsupportedSubcommand(res: RunResult): boolean {
	if (res.status === null) return true;
	return /unrecognized|unknown|usage/i.test(`${res.stderr} ${res.stdout}`);
}

function jobTarget(host: ServiceHost, label: string): string {
	return `gui/${host.uid}/${label}`;
}

function parseListPid(stdout: string): number | null {
	// `launchctl list <label>` prints a job dictionary; `launchctl list` prints a table.
	const dictMatch = stdout.match(/"PID"\s*=\s*(\d+)/);
	const tableMatch = stdout.match(/^(\d+)\s+/);
	const raw = dictMatch?.[1] ?? tableMatch?.[1];
	const pid = raw === undefined ? Number.NaN : Number(raw);
	return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
