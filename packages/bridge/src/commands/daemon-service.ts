import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import packageMeta from "../../package.json";
import {
	checkPortInUse,
	type DaemonConfig,
	type DaemonStatus,
	findProcessByPattern,
	getBroskiBinaryPath,
	getDaemonStatus,
	getKillPortHint,
	getProcessOnPort,
	getSleepPreventionTip,
	getTailLogsHint,
	IS_WINDOWS,
	installDaemon,
	isCompiledBinary,
	killProcess,
	getBunPath as platformGetBunPath,
	restartDaemon,
	stopDaemon,
	uninstallDaemon,
} from "../platform";
import { getConfiguredPort } from "./config-port";

const BROSKI_LOG_DIR = resolve(homedir(), ".broski", "logs");

export async function runInstall(linkBin?: string): Promise<void> {
	console.log("Installing Broski as background service...\n");

	const serviceName = IS_WINDOWS ? "Broski bridge task" : "Broski Link";
	if (IS_WINDOWS) {
		console.log("   Broski Link is not supported on Windows yet.");
		console.log("   Always On runs the bridge from Task Scheduler instead, without broski-link.\n");
	}

	const status = await getDaemonStatus();
	if (status.installed) {
		console.log("Warning: Broski is already installed as a background service.");
		console.log("   Run `broski uninstall` first if you want to reinstall.");
		console.log("   Run `broski status` to check if it's running.");
		return;
	}

	await mkdir(BROSKI_LOG_DIR, { recursive: true });
	console.log(`  Created log directory: ${BROSKI_LOG_DIR}`);

	const binaryPath = getBroskiBinaryPath();
	console.log(`  Binary: ${binaryPath}`);

	if (!isCompiledBinary()) {
		const bunPath = await platformGetBunPath();
		console.log(`  Bun path: ${bunPath}`);
	}

	const config: DaemonConfig = {
		binaryPath,
		args: ["--daemon"],
		logDir: BROSKI_LOG_DIR,
		workDir: homedir(),
		linkBinaryPath: linkBin,
	};

	try {
		await installDaemon(config);
	} catch (err) {
		console.error(`  Failed to install service: ${err}`);
		return;
	}

	await Bun.sleep(1000);

	await reportInstallResult(serviceName);
}

async function reportInstallResult(serviceName: string): Promise<void> {
	const status = await getDaemonStatus();
	if (!status.running) {
		console.log("\n   Service installed but may not be running.");
		console.log("   Check status with: broski status");
		console.log(`   Check logs: ${getTailLogsHint()}`);
		return;
	}

	console.log(`\n  ${serviceName} installed and running!`);
	console.log("\n   The bridge will now:");
	console.log("   - Start automatically when you log in");
	console.log("   - Stay running in the background");
	console.log("   - Restart automatically if it crashes");
	console.log("\n   Commands:");
	console.log("   - broski status    - Check if running");
	console.log("   - broski stop      - Stop the service");
	console.log("   - broski uninstall - Remove the service");
	console.log(`\n   Logs: ${BROSKI_LOG_DIR}/ (${IS_WINDOWS ? "bridge.log" : "link.log, bridge.log"})`);

	const sleepTip = getSleepPreventionTip();
	if (sleepTip) {
		console.log(`\n   Tip: ${sleepTip}`);
	}
}

export async function runUninstall(): Promise<void> {
	console.log("Uninstalling Broski background service...\n");

	const status = await getDaemonStatus();
	if (!status.installed) {
		console.log("  Broski is not installed as a background service.");
		return;
	}

	try {
		await uninstallDaemon();
		console.log("  Service removed");
	} catch (err) {
		console.error(`  Failed to uninstall service: ${err}`);
		return;
	}

	console.log("\n  Broski background service uninstalled.");
	console.log("   The bridge will no longer start automatically.");
	console.log("   Run `broski` to start it manually when needed.");
}

export async function runStatus(): Promise<void> {
	console.log("Broski Bridge Status\n");

	const status = await getDaemonStatus();
	printServiceState(status);
	printActiveProcesses();

	const configuredPort = await getConfiguredPort();
	const portInUse = await checkPortInUse(configuredPort);
	console.log(`\nPort ${configuredPort}: ${portInUse ? "  In use (bridge is listening)" : "  Not in use"}`);

	printLogFiles();

	const ver = packageMeta.version ?? "0.1.0";
	console.log(`\nVersion:            v${ver}`);
	await printUpdateState();

	if (!status.installed) {
		console.log("\n   Tip: Run `broski install` to enable Always On mode");
	}
}

function printServiceState(status: DaemonStatus): void {
	console.log(`Broski Link service: ${status.installed ? "  Installed" : "  Not installed"}`);
	if (IS_WINDOWS) {
		console.log("                       Broski Link is not supported on Windows yet.");
	}
	if (!status.installed) return;

	console.log(`Service status:      ${status.running ? "  Running" : "  Not running"}`);
	if (status.pid) {
		console.log(`Process ID:          ${status.pid}`);
	}
	if (status.configPath) {
		console.log(`Service config:      ${status.configPath}`);
	}
}

function printActiveProcesses(): void {
	const pids = findProcessByPattern("broski");
	if (pids.length === 0) return;

	console.log(`\nActive processes:   ${pids.length} found`);
	for (const pid of pids) {
		console.log(`  PID ${pid}`);
	}
}

function printLogFiles(): void {
	console.log(`\nLog files:          ${BROSKI_LOG_DIR}/`);
	if (!IS_WINDOWS) {
		console.log(`  - link.log         - broski-link output`);
	}
	console.log(`  - bridge.log       - Standard output`);
	console.log(`  - bridge.error.log - Error output`);
}

async function printUpdateState(): Promise<void> {
	const { getLastUpdateCheck } = await import("../updater");
	const lastCheck = await getLastUpdateCheck();
	if (!lastCheck) return;

	console.log(`Last update check:  ${lastCheck.checkedAt}`);
	if (lastCheck.updateAvailable) {
		console.log(`  Update available: v${lastCheck.latestVersion}`);
		console.log(`  Run \`broski update\` to install`);
	} else {
		console.log(`  Up to date`);
	}
}

export async function runStop(): Promise<void> {
	console.log("Stopping Broski bridge...\n");

	const status = await getDaemonStatus();
	if (status.installed) {
		await stopDaemon();
		console.log("  Sent stop signal to background service");
		console.log("\n   Note: The service will restart automatically (KeepAlive is enabled).");
		console.log("   To stop permanently, run: broski uninstall");
		return;
	}

	const configuredPort = await getConfiguredPort();
	const portProc = await getProcessOnPort(configuredPort);
	if (portProc && portProc.pid !== process.pid) {
		killProcess(portProc.pid);
		console.log(`\n  Stopped bridge process (PID ${portProc.pid})`);
	} else {
		const pids = findProcessByPattern("broski").filter((p) => p !== process.pid);
		if (pids.length > 0) {
			for (const pid of pids) {
				killProcess(pid);
			}
			console.log("\n  Stopped running Broski processes");
		} else {
			console.log("\n  No running Broski bridge found");
		}
	}
}

export async function runRestart(): Promise<void> {
	console.log("Restarting Broski bridge...\n");
	const port = await getConfiguredPort();

	const status = await getDaemonStatus();
	if (!status.installed) {
		console.log("   Background service not installed.");
		console.log("   Run: broski install");
		return;
	}

	console.log("Stopping service...");
	await stopDaemon();

	for (let i = 0; i < 5; i++) {
		const proc = await getProcessOnPort(port);
		if (!proc) break;
		killProcess(proc.pid);
		await Bun.sleep(300);
	}

	const orphans = findProcessByPattern("broski");
	for (const pid of orphans) {
		killProcess(pid);
	}
	await Bun.sleep(500);

	let portFree = false;
	for (let i = 0; i < 6; i++) {
		if (!(await checkPortInUse(port))) {
			portFree = true;
			break;
		}
		await Bun.sleep(500);
	}

	if (!portFree) {
		console.log(`  Failed to free port. Try: ${getKillPortHint(port)}`);
		return;
	}

	console.log("Starting service...");
	await restartDaemon();

	let ready = false;
	process.stdout.write("Waiting for bridge");
	for (let i = 0; i < 60; i++) {
		await Bun.sleep(500);
		process.stdout.write(".");
		if (await checkPortInUse(port)) {
			ready = true;
			break;
		}
	}
	console.log("");

	if (ready) {
		console.log("  Bridge restarted successfully");
		console.log(`  Listening on port ${port}`);
	} else {
		console.log("   Service started but port not yet listening");
		console.log(`   Check: ${getTailLogsHint()}`);
	}
}
