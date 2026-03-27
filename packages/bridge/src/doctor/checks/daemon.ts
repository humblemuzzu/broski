import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getBroskiBinaryPath, getDaemonConfigPath, getDaemonStatus, getDaemonType } from "../../platform";
import type { DoctorContext } from "../context";
import type { CheckResult } from "../types";
import { dirExists } from "../utils";

function daemonTypeLabel(type: string): string {
	switch (type) {
		case "launchagent":
			return "macOS LaunchAgent";
		case "systemd":
			return "Linux systemd";
		case "task-scheduler":
			return "Windows Task Scheduler";
		default:
			return "None";
	}
}

export async function runDaemonChecks(ctx: DoctorContext, opts: { deep?: boolean } = {}): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const daemonType = getDaemonType();
	results.push({
		id: "daemon_type",
		category: "daemon",
		status: "info",
		message: `Daemon type: ${daemonTypeLabel(daemonType)}`,
	});

	const status = await getDaemonStatus();
	if (status.installed) {
		results.push({ id: "daemon_installed", category: "daemon", status: "ok", message: "Background service installed" });
	} else {
		results.push({
			id: "daemon_installed",
			category: "daemon",
			status: "warning",
			message: "Background service not installed",
			fix: "Run `broski install` to enable Always On mode",
		});
	}

	if (!status.installed) {
		results.push({
			id: "daemon_running",
			category: "daemon",
			status: "info",
			message: "Daemon not installed — run check skipped",
		});
	} else if (status.running) {
		const pidLabel = status.pid ? ` (PID ${status.pid})` : "";
		results.push({ id: "daemon_running", category: "daemon", status: "ok", message: `Daemon running${pidLabel}` });
	} else {
		results.push({
			id: "daemon_running",
			category: "daemon",
			status: "warning",
			message: "Daemon installed but not running",
			fix: "Run `broski restart`",
		});
	}

	const logDirExists = await dirExists(ctx.paths.logs);
	if (!logDirExists) {
		results.push({
			id: "log_dir",
			category: "daemon",
			status: "error",
			message: "Log directory missing (~/.broski/logs)",
			fix: "Will be created automatically",
			autoFix: async () => {
				await mkdir(ctx.paths.logs, { recursive: true });
				return await dirExists(ctx.paths.logs);
			},
		});
	} else {
		const testPath = resolve(ctx.paths.logs, ".doctor-write-test");
		try {
			await writeFile(testPath, "test", "utf-8");
			await unlink(testPath);
			results.push({ id: "log_dir", category: "daemon", status: "ok", message: "Log directory writable" });
		} catch {
			results.push({
				id: "log_dir",
				category: "daemon",
				status: "error",
				message: "Log directory not writable",
				fix: `Check permissions on ${ctx.paths.logs}`,
			});
		}
	}

	const configPath = status.configPath ?? getDaemonConfigPath() ?? null;
	if (!configPath) {
		results.push({
			id: "daemon_config",
			category: "daemon",
			status: "info",
			message: "No daemon config path detected",
		});
	} else {
		try {
			const content = await readFile(configPath, "utf-8");
			const currentBinary = getBroskiBinaryPath();
			if (content.includes(currentBinary)) {
				results.push({
					id: "daemon_config",
					category: "daemon",
					status: "ok",
					message: "Daemon config matches current binary path",
				});
			} else {
				results.push({
					id: "daemon_config",
					category: "daemon",
					status: "warning",
					message: "Daemon config may reference an old binary path",
					fix: "Run `broski uninstall && broski install`",
				});
			}
		} catch {
			results.push({
				id: "daemon_config",
				category: "daemon",
				status: "info",
				message: "Could not read daemon config",
			});
		}
	}

	if (opts.deep) {
		const pidFile = resolve(ctx.paths.home, "bridge.pid");
		try {
			const raw = await readFile(pidFile, "utf-8");
			const pid = Number(raw.trim());
			if (!Number.isFinite(pid) || pid <= 0) {
				results.push({
					id: "pid_file",
					category: "daemon",
					status: "warning",
					message: "bridge.pid exists but is malformed",
				});
			} else {
				results.push({ id: "pid_file", category: "daemon", status: "info", message: `bridge.pid present (${pid})` });
			}
		} catch {
			results.push({ id: "pid_file", category: "daemon", status: "info", message: "bridge.pid not found" });
		}
	}

	return results;
}
