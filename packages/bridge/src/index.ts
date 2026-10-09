import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk/v2";
import packageMeta from "../package.json";
import { parseCli, printHelp, promptForChoice } from "./cli";
import { OpenCodeConnector } from "./connectors/opencode";
import { runDoctor } from "./doctor";
import { disableFunnel, enableFunnel } from "./funnel";
import { type BridgeLogger, createBridgeLogger } from "./logging/logger";
import { getHotspotIP, getLocalIP, getTailscaleIP, getTailscaleMagicDNS, isTailscaleConnected } from "./network";
import {
	CURRENT_PLATFORM,
	checkPortInUse,
	type DaemonConfig,
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
} from "./platform";
import { displayBanner, displayQRCode } from "./qr";
import { type BridgeServer, createBridgeServer, loadOrCreateAuthState } from "./server";
import { runSetupTailscale } from "./setup-tailscale";
import { performUpdate, startPeriodicUpdateCheck, startupUpdateCheck, stopPeriodicUpdateCheck } from "./updater";

// Daemon (Always On mode) configuration
const BROSKI_LOG_DIR = resolve(homedir(), ".broski", "logs");

type ManagedOpenCodeServer = {
	url: string;
	close: () => Promise<void>;
};

type ManualOpenCodeServer = {
	url: string;
	managed: false;
};

type OpenCodeServer = ManagedOpenCodeServer | ManualOpenCodeServer;

type OpenCodeInstance = {
	port: number;
	url: string;
	projects: Array<{ id: string; worktree: string; time?: { created?: number; updated?: number } }>;
	lastActivity: number;
};

const FALLBACK_PORT = 18274;

/** Read the configured bridge port (from config.json), falling back to 18274. */
async function getConfiguredPort(): Promise<number> {
	try {
		const { readConfig } = await import("./config");
		const cfg = await readConfig();
		return cfg.network.port || FALLBACK_PORT;
	} catch {
		return FALLBACK_PORT;
	}
}

// ============================================================================
// Daemon Management (Always On Mode)
// ============================================================================

// getBunPath is now imported as platformGetBunPath from platform.ts

async function _getBridgeScriptPath(): Promise<string> {
	if (isCompiledBinary()) {
		return process.execPath; // The binary IS the bridge
	}
	// Dev mode: get the script being run
	const scriptUrl = import.meta.url;
	if (scriptUrl.startsWith("file://")) {
		return scriptUrl.replace("file://", "");
	}
	return resolve(dirname(new URL(import.meta.url).pathname), "index.ts");
}

// generateLaunchAgentPlist removed — platform.ts handles daemon config generation

async function runInstall(): Promise<void> {
	console.log("Installing Broski as background service...\n");

	// Check if already installed
	const status = await getDaemonStatus();
	if (status.installed) {
		console.log("Warning: Broski is already installed as a background service.");
		console.log("   Run `broski uninstall` first if you want to reinstall.");
		console.log("   Run `broski status` to check if it's running.");
		return;
	}

	// Create log directory
	await mkdir(BROSKI_LOG_DIR, { recursive: true });
	console.log(`  Created log directory: ${BROSKI_LOG_DIR}`);

	// Get binary path
	const binaryPath = getBroskiBinaryPath();
	console.log(`  Binary: ${binaryPath}`);

	// If running in dev mode, also log bun path
	if (!isCompiledBinary()) {
		const bunPath = await platformGetBunPath();
		console.log(`  Bun path: ${bunPath}`);
	}

	// Install daemon using platform.ts
	const config: DaemonConfig = {
		binaryPath,
		args: ["--daemon", "--hotspot"],
		logDir: BROSKI_LOG_DIR,
		workDir: homedir(),
	};

	try {
		await installDaemon(config);
	} catch (err) {
		console.error(`  Failed to install service: ${err}`);
		return;
	}

	// Wait a moment for the service to start
	await Bun.sleep(1000);

	// Verify it's running
	const newStatus = await getDaemonStatus();
	if (newStatus.running) {
		console.log("\n  Broski bridge installed and running!");
		console.log("\n   The bridge will now:");
		console.log("   - Start automatically when you log in");
		console.log("   - Stay running in the background");
		console.log("   - Restart automatically if it crashes");
		console.log("\n   Commands:");
		console.log("   - broski status    - Check if running");
		console.log("   - broski stop      - Stop the service");
		console.log("   - broski uninstall - Remove the service");
		console.log(`\n   Logs: ${BROSKI_LOG_DIR}/bridge.log`);

		// Platform-specific sleep prevention tip
		const sleepTip = getSleepPreventionTip();
		if (sleepTip) {
			console.log(`\n   Tip: ${sleepTip}`);
		}
	} else {
		console.log("\n   Service installed but may not be running.");
		console.log("   Check status with: broski status");
		console.log(`   Check logs: ${getTailLogsHint()}`);
	}
}

async function runUninstall(): Promise<void> {
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

async function runStatus(): Promise<void> {
	console.log("Broski Bridge Status\n");

	const status = await getDaemonStatus();
	console.log(`Background service: ${status.installed ? "  Installed" : "  Not installed"}`);

	if (status.installed) {
		console.log(`Service status:     ${status.running ? "  Running" : "  Not running"}`);
		if (status.pid) {
			console.log(`Process ID:         ${status.pid}`);
		}
	}

	// Check for any broski process
	const pids = findProcessByPattern("broski");
	if (pids.length > 0) {
		console.log(`\nActive processes:   ${pids.length} found`);
		for (const p of pids) {
			console.log(`  PID ${p}`);
		}
	}

	// Check if the configured port is in use
	const configuredPort = await getConfiguredPort();
	const portInUse = await checkPortInUse(configuredPort);
	console.log(`\nPort ${configuredPort}: ${portInUse ? "  In use (bridge is listening)" : "  Not in use"}`);

	// Show log file location
	console.log(`\nLog files:          ${BROSKI_LOG_DIR}/`);
	console.log(`  - bridge.log       - Standard output`);
	console.log(`  - bridge.error.log - Error output`);

	// Show version
	const ver = packageMeta.version ?? "0.1.0";
	console.log(`\nVersion:            v${ver}`);

	// Show last update check result
	const { getLastUpdateCheck } = await import("./updater");
	const lastCheck = await getLastUpdateCheck();
	if (lastCheck) {
		console.log(`Last update check:  ${lastCheck.checkedAt}`);
		if (lastCheck.updateAvailable) {
			console.log(`  Update available: v${lastCheck.latestVersion}`);
			console.log(`  Run \`broski update\` to install`);
		} else {
			console.log(`  Up to date`);
		}
	}

	if (!status.installed) {
		console.log("\n   Tip: Run `broski install` to enable Always On mode");
	}
}

async function runQR(detectHotspot: boolean): Promise<void> {
	console.log("Generating QR code for phone pairing...\n");

	// Load existing auth token from new token.json format (or fallback to legacy)
	let authToken: string;
	let tlsEnabled = false;
	let certSha256: string | null = null;

	try {
		// Try new format first (token.json)
		const tokenJsonFile = resolve(homedir(), ".broski", "token.json");
		const raw = await readFile(tokenJsonFile, "utf-8");
		const parsed = JSON.parse(raw);
		authToken = parsed.token?.trim() ?? "";
		if (!authToken || authToken.length < 16) {
			throw new Error("Invalid token in token.json");
		}
	} catch {
		// Fallback to legacy format
		try {
			const tokenFile = resolve(homedir(), ".broski", "token");
			const existing = await readFile(tokenFile, "utf-8");
			authToken = existing.trim();
			if (authToken.length < 16) {
				throw new Error("Invalid token");
			}
		} catch {
			console.log("⚠️  No auth token found. Run `broski` or `broski install` first to start the bridge.");
			return;
		}
	}

	// Check for TLS certificate
	try {
		const { ensureTlsMaterial, isTlsEnabledByEnv } = await import("./tls");
		tlsEnabled = isTlsEnabledByEnv();
		if (tlsEnabled) {
			const tlsMaterial = await ensureTlsMaterial();
			certSha256 = tlsMaterial.certSha256;
		}
	} catch {
		// TLS not available, continue without it
	}

	// Check if bridge is actually running
	const port = await getConfiguredPort();
	const bridgeRunning = await checkPortInUse(port);

	if (!bridgeRunning) {
		console.log(`⚠️  Bridge is not running on port ${port}.`);
		console.log("   Start it with `broski` or `broski install` first.");
		console.log("");
	}

	// Detect network
	const localIP = getLocalIP();
	const tailscaleIP = await getTailscaleIP();
	const magicDNS = await getTailscaleMagicDNS();
	const hotspotIP = detectHotspot ? getHotspotIP() : null;

	// Get version (use static import — Bun.file() fails in compiled binaries)
	const version = packageMeta.version ?? "0.1.0";

	displayQRCode({
		localIP,
		tailscaleIP,
		magicDNS,
		funnelURL: null,
		hotspotIP,
		port,
		version,
		authToken,
		tlsEnabled,
		certSha256,
	});

	if (bridgeRunning) {
		console.log("✓ Bridge is running. Scan the QR code with the Broski app.");
	}
}

async function runShowToken(): Promise<void> {
	console.log("Broski Auth Token\n");

	// Load existing auth token from new token.json format (or fallback to legacy)
	let authToken: string;
	let expiresAt: number | null = null;

	try {
		// Try new format first (token.json)
		const tokenJsonFile = resolve(homedir(), ".broski", "token.json");
		const raw = await readFile(tokenJsonFile, "utf-8");
		const parsed = JSON.parse(raw);
		authToken = parsed.token?.trim() ?? "";
		expiresAt = parsed.expiresAt ?? null;
		if (!authToken || authToken.length < 16) {
			throw new Error("Invalid token in token.json");
		}
	} catch {
		// Fallback to legacy format
		try {
			const tokenFile = resolve(homedir(), ".broski", "token");
			const existing = await readFile(tokenFile, "utf-8");
			authToken = existing.trim();
			if (authToken.length < 16) {
				throw new Error("Invalid token");
			}
		} catch {
			console.log("  No auth token found.");
			console.log("  Run `broski` or `broski install` first to start the bridge.");
			return;
		}
	}

	console.log(`  Token: ${authToken}`);
	console.log("");
	if (expiresAt) {
		const expiresDate = new Date(expiresAt);
		const now = new Date();
		const daysRemaining = Math.ceil((expiresAt - now.getTime()) / (1000 * 60 * 60 * 24));
		console.log(`  Expires: ${expiresDate.toLocaleDateString()} (${daysRemaining} days)`);
	}
	console.log("");
	console.log("  Use this token in the Broski app manual connection dialog.");
	console.log("  Or run `broski qr` to generate a scannable QR code.");
}

async function runStop(): Promise<void> {
	console.log("Stopping Broski bridge...\n");

	const status = await getDaemonStatus();
	if (status.installed) {
		await stopDaemon();
		console.log("  Sent stop signal to background service");
		console.log("\n   Note: The service will restart automatically (KeepAlive is enabled).");
		console.log("   To stop permanently, run: broski uninstall");
		return;
	}

	// Kill by port first (safe), fall back to pattern match
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

async function runRestart(): Promise<void> {
	console.log("Restarting Broski bridge...\n");
	const port = await getConfiguredPort();

	const status = await getDaemonStatus();
	if (!status.installed) {
		console.log("   Background service not installed.");
		console.log("   Run: broski install");
		return;
	}

	// Stop the daemon
	console.log("Stopping service...");
	await stopDaemon();

	// Kill ALL broski processes on the port
	for (let i = 0; i < 5; i++) {
		const proc = await getProcessOnPort(port);
		if (!proc) break;
		killProcess(proc.pid);
		await Bun.sleep(300);
	}

	// Also kill any orphaned broski processes
	const orphans = findProcessByPattern("broski");
	for (const pid of orphans) {
		killProcess(pid);
	}
	await Bun.sleep(500);

	// Wait for port to be truly free
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

	// Wait for it to be ready (30s timeout — OpenCode bootstrap alone can take 10s+)
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

async function waitForOpencodeReady(url: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			// /path is cheap and always available; it also validates instance wiring.
			const res = await fetch(`${url}/path`, { signal: AbortSignal.timeout(750) });
			if (res.ok) return true;
		} catch {
			// keep retrying
		}
		await Bun.sleep(150);
	}
	return false;
}

async function discoverRunningOpencodeInstances(portsToScan: number[], verbose: boolean): Promise<OpenCodeInstance[]> {
	if (verbose) {
		console.log("Scanning for running OpenCode instances...");
	}

	const instances: OpenCodeInstance[] = [];

	// Limit concurrency to avoid flooding the system with hundreds of parallel
	// connection attempts (common when scanning large port ranges).
	const queue = portsToScan.slice();
	const concurrency = 32;
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			for (;;) {
				const port = queue.shift();
				if (port == null) return;
				try {
					// Use 127.0.0.1 (not localhost) to avoid IPv6-only localhost resolution issues.
					const url = `http://127.0.0.1:${port}`;
					// /path is cheap and stable across OpenCode versions; it validates that the port is an OpenCode server.
					const ready = await fetch(`${url}/path`, { signal: AbortSignal.timeout(750) });
					if (!ready.ok) continue;

					let projects: OpenCodeInstance["projects"] = [];
					try {
						// Best-effort: older/newer versions may not expose this endpoint.
						const response = await fetch(`${url}/project`, { signal: AbortSignal.timeout(750) });
						if (response.ok) {
							projects = (await response.json()) as OpenCodeInstance["projects"];
						}
					} catch {
						// ignore
					}

					// Find most recent activity across all projects
					let lastActivity = 0;
					for (const project of projects) {
						const updated = project.time?.updated ?? project.time?.created ?? 0;
						if (updated > lastActivity) {
							lastActivity = updated;
						}
					}

					instances.push({ port, url, projects, lastActivity });
				} catch {
					// Port not responding or not OpenCode
				}
			}
		}),
	);

	// Sort by last activity (most recent first)
	instances.sort((a, b) => b.lastActivity - a.lastActivity);
	return instances;
}

type OpencodeBootstrap = {
	server: OpenCodeServer;
	client?: OpencodeClient;
};

// Global server reference for shutdown
let opencodeServer: OpenCodeServer | null = null;
let bridgeServer: BridgeServer | null = null;
let primaryEventStreamController: AbortController | null = null;
const extraEventStreamControllers: AbortController[] = [];
let healthTimer: Timer | null = null;
let opencodeConnector: OpenCodeConnector | null = null;
let restartInFlight = false;
let restartCount = 0;
const MAX_RESTARTS = 10;
const RESTART_COOLDOWN_MS = 30_000;
let lastRestartTime = 0;
let consecutiveHealthFailures = 0;
const FAILURES_TO_TRIGGER_RESTART = 3;
let activeBridgeLogger: BridgeLogger | null = null;
let managedHostname = "127.0.0.1";
let managedPort = 0;
let verboseMode = false;
let funnelPort: number | null = null;

function normalizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, "");
}

async function subscribeOpenCodeStream(
	opencode: OpenCodeConnector,
	label: string,
	verbose: boolean,
): Promise<AbortController> {
	const controller = await opencode.startEventStream((event) => {
		if (verbose) {
			console.log("[SDK Event]", JSON.stringify(event));
		}
		bridgeServer?.enqueueSdkEvent(event);
	});
	if (verbose) {
		console.log(`✓ Subscribed to OpenCode events (${label}): ${opencode.url}`);
	}
	return controller;
}

// Graceful shutdown handler
async function shutdown(signal: string, exitCode = 0) {
	console.log(`\n${signal} received. Shutting down...`);

	stopPeriodicUpdateCheck();

	if (healthTimer) {
		clearInterval(healthTimer);
		healthTimer = null;
	}

	if (primaryEventStreamController || extraEventStreamControllers.length > 0) {
		console.log("Stopping OpenCode event streams...");
		if (primaryEventStreamController) {
			primaryEventStreamController.abort();
			primaryEventStreamController = null;
		}
		while (extraEventStreamControllers.length > 0) {
			extraEventStreamControllers.pop()?.abort();
		}
	}

	if (funnelPort !== null) {
		console.log("Disabling Tailscale Funnel...");
		await disableFunnel(funnelPort);
		funnelPort = null;
	}

	if (bridgeServer) {
		console.log("Stopping bridge server...");
		bridgeServer.stop(true);
		bridgeServer = null;
	}

	if (opencodeServer && "close" in opencodeServer) {
		console.log("Stopping managed OpenCode server...");
		await opencodeServer.close();
		opencodeServer = null;
	} else if (opencodeServer) {
		console.log("OpenCode server is external - leaving it running");
	}

	// Flush log file streams before exiting
	if (activeBridgeLogger) {
		await activeBridgeLogger.flush().catch(() => {});
	}

	console.log("Shutdown complete. Goodbye!");
	process.exit(exitCode);
}

async function restartManagedOpenCode(): Promise<boolean> {
	if (restartInFlight) return false;
	if (!opencodeServer || !("close" in opencodeServer)) return false;
	if (!opencodeConnector) return false;

	restartInFlight = true;
	try {
		console.log("Restarting managed OpenCode...");

		if (primaryEventStreamController) {
			primaryEventStreamController.abort();
			primaryEventStreamController = null;
		}

		try {
			await opencodeServer.close();
		} catch {
			// ignore
		}

		const bootstrap = await bootstrapManagedOpenCode(managedHostname, managedPort, verboseMode);
		opencodeServer = bootstrap.server;

		opencodeConnector.updateBaseUrl(opencodeServer.url);

		primaryEventStreamController = await subscribeOpenCodeStream(opencodeConnector, "primary", verboseMode);

		bridgeServer?.broadcast({ type: "status", data: { opencodeRunning: true } });
		consecutiveHealthFailures = 0;
		console.log("✓ OpenCode restarted");
		return true;
	} catch (error) {
		console.error("Failed to restart OpenCode:", error);
		bridgeServer?.broadcast({ type: "status", data: { opencodeRunning: false } });
		return false;
	} finally {
		restartInFlight = false;
	}
}

async function bootstrapManagedOpenCode(hostname: string, port: number, verbose: boolean): Promise<OpencodeBootstrap> {
	const MAX_RETRIES = 3;
	const RETRY_DELAY_MS = 3000;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		console.log(`Starting OpenCode (managed)...${attempt > 1 ? ` (attempt ${attempt}/${MAX_RETRIES})` : ""}`);
		try {
			const { client, server } = await createOpencode({
				hostname,
				port,
				timeout: 10000,
			});

			const ready = await waitForOpencodeReady(server.url, 10000);
			if (!ready) {
				try {
					server.close();
				} catch {
					// ignore
				}
				throw new Error(`OpenCode started but did not become ready at ${server.url}`);
			}

			if (verbose) {
				console.log(`✓ OpenCode ready at ${server.url}`);
			} else {
				console.log("✓ OpenCode ready");
			}

			return {
				client,
				server: {
					url: server.url,
					close: async () => {
						try {
							server.close();
							console.log("  Managed OpenCode server stopped");
						} catch (error) {
							console.error("  Error stopping managed OpenCode server:", error);
						}
					},
				},
			};
		} catch (error) {
			if (attempt < MAX_RETRIES) {
				console.log(`  OpenCode not ready, retrying in ${RETRY_DELAY_MS / 1000}s...`);
				await Bun.sleep(RETRY_DELAY_MS);
				continue;
			}
			console.error("Failed to start managed OpenCode server after all retries:", error);
			console.log(
				"  Ensure OpenCode is installed and on PATH (install: curl -fsSL https://opencode.ai/install | bash  or  bun add -g opencode-ai)",
			);
			throw error;
		}
	}

	// TypeScript: unreachable, but satisfies return type
	throw new Error("Unreachable");
}

async function bootstrapManualOpenCode(url: string): Promise<OpencodeBootstrap> {
	console.log(`Attaching to OpenCode (manual): ${url}`);
	const ready = await waitForOpencodeReady(url, 5000);
	if (!ready) {
		console.log("⚠️  OpenCode is not responding at the provided URL.");
	} else {
		console.log("✓ OpenCode is responding");
	}
	return {
		server: { url, managed: false },
	};
}

function defaultAttachPorts(): number[] {
	// We only scan in explicit --attach mode (power users).
	// Default range covers the most common ports observed in practice.
	const ports: number[] = [4096];
	for (let i = 0; i < 256; i++) ports.push(64864 + i);
	for (let i = 0; i < 256; i++) ports.push(49152 + i);
	return ports;
}

function discoverListeningPortsFromLsof(verbose: boolean): number[] {
	try {
		if (IS_WINDOWS) {
			// On Windows use netstat
			const result = spawnSync("netstat", ["-ano"], { encoding: "utf8", timeout: 5000 });
			const out = result.stdout ?? "";
			const ports = new Set<number>();
			for (const line of out.split("\n")) {
				const m = line.match(/:(\d+)\s+.*LISTENING/);
				if (!m) continue;
				const port = Number(m[1]);
				if (Number.isFinite(port) && port > 0 && port <= 65535) ports.add(port);
			}
			return Array.from(ports);
		}

		// macOS/Linux: lsof
		const res = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
		const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
		if (!out.trim()) return [];

		const ports = new Set<number>();
		for (const line of out.split("\n")) {
			const m = line.match(/TCP\s+.*?:(\d+)\s+\(LISTEN\)/);
			if (!m) continue;
			const port = Number(m[1]);
			if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
			ports.add(port);
		}
		return Array.from(ports);
	} catch (err) {
		if (verbose) {
			console.warn("Port scan failed (continuing without it):", err);
		}
		return [];
	}
}

function isOpencodeCliAvailable(verbose: boolean): boolean {
	try {
		// Fast PATH check to avoid slow retries when OpenCode isn't installed.
		const res = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 1500 });
		if (res.error) {
			if (verbose) {
				console.warn("OpenCode CLI check failed:", res.error);
			}
			return false;
		}
		return res.status === 0;
	} catch (err) {
		if (verbose) {
			console.warn("OpenCode CLI check threw:", err);
		}
		return false;
	}
}

async function bootstrapAttachOpenCode(verbose: boolean): Promise<OpencodeBootstrap> {
	const lsofPorts = discoverListeningPortsFromLsof(verbose);
	const ports = Array.from(new Set([...defaultAttachPorts(), ...lsofPorts]));
	const instances = await discoverRunningOpencodeInstances(ports, verbose);
	if (instances.length === 0) {
		console.log("No running OpenCode servers found.");
		console.log("  Start one: `opencode serve`");
		console.log("  Or attach explicitly: `broski --opencode-url http://127.0.0.1:4096`");
		throw new Error("No running OpenCode servers found");
	}

	if (instances.length === 1) {
		const inst = instances[0]!;
		console.log(`✓ Found OpenCode at ${inst.url}`);
		return { server: { url: inst.url, managed: false } };
	}

	const choices = instances.map((inst) => {
		const ago = inst.lastActivity > 0 ? `${Math.round((Date.now() - inst.lastActivity) / 1000 / 60)}m ago` : "unknown";
		return `${inst.url} (${inst.projects.length} projects, last active ${ago})`;
	});

	const selected = await promptForChoice("Multiple OpenCode servers detected:", choices);
	if (selected == null) {
		throw new Error("Attach cancelled");
	}
	const inst = instances[selected]!;
	console.log(`✓ Using OpenCode at ${inst.url}`);
	return { server: { url: inst.url, managed: false } };
}

async function discoverLocalOpencodeUrls(verbose: boolean): Promise<string[]> {
	const ports = discoverListeningPortsFromLsof(verbose);
	if (ports.length === 0) return [];
	const instances = await discoverRunningOpencodeInstances(ports, false);
	return instances.map((i) => i.url);
}

async function main() {
	const cli = parseCli(process.argv, process.env);

	// Load persisted config early so ALL subcommands (including `qr`) behave consistently.
	const { readConfig } = await import("./config");
	const config = await readConfig();

	const argvHas = (flag: string): boolean => process.argv.includes(flag);
	const argvHasPortFlag = argvHas("--port") || argvHas("--bridge-port");

	// Apply config defaults only when user didn't explicitly override via env/CLI.
	if (!process.env.BROSKI_TLS) {
		process.env.BROSKI_TLS = config.security.tls ? "1" : "0";
	}
	if (!process.env.BROSKI_TOKEN_TTL_DAYS) {
		process.env.BROSKI_TOKEN_TTL_DAYS = String(config.security.tokenTtlDays);
	}
	if (cli.help) {
		printHelp();
		return;
	}

	if (cli.subCommand === "version") {
		const ver = packageMeta.version ?? "0.1.0";
		const mode = isCompiledBinary() ? "(compiled binary)" : "(dev mode - bun)";
		console.log(`broski v${ver} ${mode}`);
		console.log(`Platform: ${CURRENT_PLATFORM}-${process.arch}`);
		return;
	}

	if (cli.subCommand === "update") {
		const ver = packageMeta.version ?? "0.1.0";
		await performUpdate(ver, (msg) => console.log(msg));
		return;
	}

	if (cli.subCommand === "doctor") {
		await runDoctor({
			json: cli.doctorJson,
			fix: cli.doctorFix,
			deep: cli.doctorDeep,
			profile: cli.doctorProfile as "all" | "network" | "pairing" | "agents" | "daemon" | "security",
			export: cli.doctorExport,
		});
		return;
	}

	if (cli.subCommand === "setup") {
		const { runOnboardingWizard } = await import("./wizard/onboarding");
		if (cli.nonInteractive) {
			await runOnboardingWizard(null, {
				nonInteractive: true,
				agents: cli.setupAgents.length > 0 ? cli.setupAgents : undefined,
				networkMode: cli.setupNetworkMode || undefined,
				tls: cli.setupNoTls ? false : (cli.setupTls ?? undefined),
				tokenTtl: cli.setupTokenTtl ?? undefined,
				daemon: cli.setupNoDaemon ? false : cli.daemon ? true : undefined,
				port: cli.bridgePort !== 18274 ? cli.bridgePort : undefined,
			});
		} else {
			const { ClackPrompter } = await import("./wizard");
			const prompter = new ClackPrompter();
			await runOnboardingWizard(prompter, {
				quick: cli.setupQuick,
				advanced: cli.setupAdvanced,
			});
		}
		return;
	}

	if (cli.subCommand === "configure") {
		const { ClackPrompter } = await import("./wizard");
		const { runConfigure } = await import("./wizard/configure");
		const prompter = new ClackPrompter();
		await runConfigure(prompter);
		return;
	}

	if (cli.subCommand === "troubleshoot") {
		const { ClackPrompter } = await import("./wizard");
		const { runTroubleshootWizard } = await import("./wizard/troubleshoot");
		const prompter = new ClackPrompter();
		await runTroubleshootWizard(prompter);
		return;
	}

	if (cli.subCommand === "logs") {
		const { runLogs } = await import("./logs");
		await runLogs(cli);
		return;
	}

	if (cli.subCommand === "setup-tailscale") {
		await runSetupTailscale();
		return;
	}

	if (cli.subCommand === "install") {
		await runInstall();
		return;
	}

	if (cli.subCommand === "uninstall") {
		await runUninstall();
		return;
	}

	if (cli.subCommand === "status") {
		await runStatus();
		return;
	}

	if (cli.subCommand === "stop") {
		await runStop();
		return;
	}

	if (cli.subCommand === "restart") {
		await runRestart();
		return;
	}

	if (cli.subCommand === "qr") {
		await runQR(cli.detectHotspot);
		return;
	}

	if (cli.subCommand === "show-token") {
		if (isCompiledBinary()) {
			console.log("This command is not available in production builds.");
			console.log("Use `broski qr` to display the QR code for pairing instead.");
			return;
		}
		await runShowToken();
		return;
	}

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	if (!IS_WINDOWS) {
		process.on("SIGTSTP", () => void shutdown("SIGTSTP"));
	}
	let _shuttingDownFromRejection = false;
	process.on("unhandledRejection", (reason) => {
		if (_shuttingDownFromRejection) return;
		_shuttingDownFromRejection = true;
		console.error("[FATAL] Unhandled promise rejection:", reason instanceof Error ? reason.stack : reason);
		void shutdown("UNHANDLED_REJECTION", 1);
	});
	verboseMode = cli.verbose;
	managedHostname = cli.opencodeHostname;
	managedPort = cli.opencodePort;

	// First-run wizard trigger
	if (!cli.skipWizard && !cli.daemon) {
		const { readConfig } = await import("./config");
		const { getConfigPath } = await import("./config/read-write");
		const { existsSync } = await import("node:fs");
		const config = await readConfig();
		if (!config.wizard.completedSetup) {
			const configPath = getConfigPath();
			// Only trigger if config file doesn't exist (true first run)
			if (!existsSync(configPath)) {
				console.log("\nFirst time? Let's get you set up!\n");
				try {
					const { ClackPrompter } = await import("./wizard");
					const { runOnboardingWizard } = await import("./wizard/onboarding");
					const clack = await import("@clack/prompts");
					const shouldRun = await clack.confirm({
						message: "Run the setup wizard?",
						initialValue: true,
					});
					if (shouldRun && !clack.isCancel(shouldRun)) {
						const prompter = new ClackPrompter();
						await runOnboardingWizard(prompter);
					}
				} catch {
					// Wizard cancelled or error, continue to serve
				}
			}
		}
	}

	const version = packageMeta.version ?? "0.1.0";

	displayBanner();

	const port = cli.bridgePort;
	const effectivePort =
		!argvHasPortFlag && !process.env.BROSKI_PORT && config.network.port ? config.network.port : port;

	let bootstrap: OpencodeBootstrap | null = null;
	let opencode: OpenCodeConnector | null = null;

	try {
		if (cli.opencodeMode === "manual") {
			if (!cli.opencodeUrl) {
				console.log("Manual OpenCode mode requested but no --opencode-url/OPENCODE_BASE_URL provided.");
				console.log("Continuing without OpenCode (Claude Code / Codex still work).");
			} else {
				bootstrap = await bootstrapManualOpenCode(cli.opencodeUrl);
			}
		} else if (cli.opencodeMode === "attach") {
			bootstrap = await bootstrapAttachOpenCode(cli.verbose);
		} else {
			if (!isOpencodeCliAvailable(cli.verbose)) {
				console.log("OpenCode CLI not found in PATH; skipping OpenCode bootstrap.");
			} else {
				bootstrap = await bootstrapManagedOpenCode(cli.opencodeHostname, cli.opencodePort, cli.verbose);
			}
		}
	} catch (err) {
		console.log("⚠️  OpenCode not available; continuing without it.");
		if (cli.verbose) {
			console.warn(err);
		}
		bootstrap = null;
	}

	if (bootstrap) {
		opencodeServer = bootstrap.server;
		opencode = new OpenCodeConnector({
			baseUrl: opencodeServer.url,
			client: bootstrap.client,
		});
		opencodeConnector = opencode;
	} else {
		opencodeServer = null;
		opencodeConnector = null;
	}

	// Load auth + create server FIRST so the port binds fast.
	// Network detection (Tailscale CLI calls) can take 5-15s and is only
	// needed for QR display / funnel — defer it until after the port is up.
	if (cli.daemon) console.log("[daemon] Loading auth token...");
	// Load persistent auth token (same token survives bridge restarts)
	const auth = await loadOrCreateAuthState(cli.newToken, config.security.tokenTtlDays);
	if (cli.newToken) {
		console.log("✓ New auth token generated (old QR codes are now invalid)");
	} else {
		console.log("✓ Auth token loaded (persistent across restarts)");
	}

	if (cli.daemon) console.log("[daemon] Creating bridge server...");

	// Create leveled logger — binary users see only important events;
	// dev mode shows everything; all levels always go to the log file.
	const bridgeLogger = createBridgeLogger({
		verbose: cli.verbose,
	});
	activeBridgeLogger = bridgeLogger;

	// Create bridge server
	try {
		// If --funnel is requested, optimistically enable the loopback server.
		// Tailscale connectivity is checked after binding (the loopback server
		// on 127.0.0.1:0 is harmless if funnel turns out to be unavailable).
		const willEnableFunnel = cli.enableFunnel;
		bridgeServer = await createBridgeServer({
			port: effectivePort,
			opencode,
			version,
			auth,
			tokenTtlDays: config.security.tokenTtlDays,
			enableLoopbackInsecureServer: willEnableFunnel,
			restartOpenCode: restartManagedOpenCode,
			bridgeLogger,
		});
	} catch (error: any) {
		if (error?.code === "EADDRINUSE") {
			console.error(`\n❌ Bridge port ${effectivePort} is already in use.`);
			console.error("This usually means another broski process is still running.");
			console.error("If you stopped it with Ctrl+Z, it was suspended (not terminated) and will keep the port open.");
			console.error("Fix options:");
			console.error("  - If it is a suspended job: return to that terminal, run `fg`, then press Ctrl+C.");
			console.error(`  - Or find and stop the process holding the port:`);
			console.error(`      ${getKillPortHint(effectivePort)}`);
			console.error(`  - Dev fallback: run the bridge on a different port: --port 0 (random free port)\n`);

			// Best-effort: print the owning PID to make this frictionless.
			try {
				const proc = await getProcessOnPort(effectivePort);
				if (proc) {
					console.error(`Port owner: ${proc.name} (PID ${proc.pid})`);
					console.error("");
				}
			} catch {
				// ignore
			}
		} else {
			console.error("\n❌ Failed to start bridge server:", error);
		}

		// If we started OpenCode in managed mode, stop it to avoid orphan processes.
		if (opencodeServer && "close" in opencodeServer) {
			try {
				await opencodeServer.close();
			} catch {
				// ignore
			}
		}
		process.exit(1);
	}
	const bridgePort = bridgeServer.port();

	// Port is now bound — health checks will pass.
	// Now do the slow network detection (Tailscale CLI calls).
	if (cli.daemon) console.log("[daemon] Detecting network...");
	const localIP = getLocalIP();
	if (cli.daemon) console.log(`[daemon] localIP: ${localIP}`);
	const tailscaleIP = await getTailscaleIP();
	if (cli.daemon) console.log(`[daemon] tailscaleIP: ${tailscaleIP}`);
	const magicDNS = await getTailscaleMagicDNS();
	if (cli.daemon) console.log(`[daemon] magicDNS: ${magicDNS}`);
	const tailscaleConnected = await isTailscaleConnected();
	if (cli.daemon) console.log(`[daemon] tailscaleConnected: ${tailscaleConnected}`);
	const hotspotIP = cli.detectHotspot ? getHotspotIP() : null;
	if (cli.daemon) console.log(`[daemon] hotspotIP: ${hotspotIP}`);

	if (cli.detectHotspot) {
		if (hotspotIP) {
			console.log(`✓ Hotspot IP detected: ${hotspotIP}`);
		} else {
			console.log("ℹ️  Hotspot detection enabled but no hotspot IP found");
			console.log("   Ensure your device is connected to a mobile hotspot");
		}
	}

	if (!tailscaleConnected) {
		console.log("ℹ️  Tailscale not connected. Local network access only.");
		if (cli.enableFunnel) {
			console.log("⚠️  --funnel requires Tailscale. Skipping Funnel setup.");
		}
	}

	let funnelURL: string | null = null;
	if (cli.enableFunnel && tailscaleConnected) {
		console.log("Enabling Tailscale Funnel...");
		const funnelBackendPort = bridgeServer.funnelBackendPort() ?? bridgePort;
		const result = await enableFunnel(funnelBackendPort);
		if (result.success && result.url) {
			funnelURL = result.url;
			funnelPort = funnelBackendPort;
			console.log(`✓ Funnel enabled: ${funnelURL}`);
		} else {
			console.log(`⚠️  Funnel setup failed: ${result.error ?? "unknown error"}`);
		}
	}

	if (opencode) {
		// Subscribe to OpenCode events and forward to clients.
		// Also subscribe to any other local OpenCode servers so a TUI using a
		// different instance still drives real-time updates in the app.
		primaryEventStreamController = await subscribeOpenCodeStream(opencode, "primary", cli.verbose);

		try {
			const primaryUrl = normalizeBaseUrl(opencode.url);
			const extraUrls = (await discoverLocalOpencodeUrls(cli.verbose))
				.map(normalizeBaseUrl)
				.filter((u) => u !== primaryUrl);

			const seen = new Set<string>();
			for (const u of extraUrls) {
				if (seen.has(u)) continue;
				seen.add(u);
				const extra = new OpenCodeConnector({ baseUrl: u });
				const ctrl = await subscribeOpenCodeStream(extra, "extra", cli.verbose);
				extraEventStreamControllers.push(ctrl);
			}
		} catch (err) {
			if (cli.verbose) {
				console.warn("⚠️  Failed to subscribe to extra local OpenCode servers:", err);
			}
		}
	}

	// Managed mode: keep OpenCode alive with conservative restart policy.
	// Requires 3 consecutive health failures before restarting, with 30s cooldown.
	if (opencodeServer && "close" in opencodeServer) {
		healthTimer = setInterval(() => {
			void (async () => {
				if (!opencodeConnector) return;
				if (restartInFlight) return;
				if (Date.now() - lastRestartTime < RESTART_COOLDOWN_MS) return;

				const ok = await opencodeConnector.isRunning();
				if (ok) {
					consecutiveHealthFailures = 0;
					return;
				}

				consecutiveHealthFailures++;
				if (consecutiveHealthFailures < FAILURES_TO_TRIGGER_RESTART) {
					console.log(`[health] OpenCode not responding (${consecutiveHealthFailures}/${FAILURES_TO_TRIGGER_RESTART})`);
					return;
				}
				consecutiveHealthFailures = 0;

				if (restartCount >= MAX_RESTARTS) {
					console.error(`[health] OpenCode has restarted ${MAX_RESTARTS} times — automatic restarts disabled`);
					if (healthTimer) {
						clearInterval(healthTimer);
						healthTimer = null;
					}
					return;
				}

				restartCount++;
				lastRestartTime = Date.now();
				bridgeServer?.broadcast({ type: "status", data: { opencodeRunning: false } });
				await restartManagedOpenCode();
			})();
		}, 30_000);
	}

	const tlsInfo = bridgeServer.tls();
	displayQRCode({
		localIP,
		tailscaleIP,
		magicDNS,
		funnelURL,
		hotspotIP,
		port: bridgePort,
		version,
		authToken: bridgeServer.authToken(),
		tlsEnabled: tlsInfo.enabled,
		certSha256: tlsInfo.certSha256,
	});

	console.log(`\n✓ Bridge listening on port ${bridgePort}`);
	console.log("  Press Ctrl+C to shutdown");
	if (!opencodeServer) {
		console.log("  (OpenCode not detected - OpenCode-only features are unavailable)");
	} else if ("close" in opencodeServer) {
		console.log("  (OpenCode is managed by the bridge and will stop on shutdown)");
	} else {
		console.log("  (OpenCode is external and will be left running)");
	}

	// Non-blocking update check on startup
	startupUpdateCheck(version, (msg) => console.log(msg))
		.then(async (result) => {
			if (!result?.updateAvailable) return;
			const ocRunning = opencodeConnector ? await opencodeConnector.isRunning().catch(() => false) : false;
			bridgeServer?.broadcast({
				type: "status",
				data: {
					opencodeRunning: ocRunning,
					updateAvailable: true,
					latestVersion: result.latestVersion,
					currentVersion: result.currentVersion,
				},
			});
		})
		.catch(() => {
			/* best-effort */
		});

	// For daemon mode: check for updates every 24h
	if (cli.daemon) {
		startPeriodicUpdateCheck(
			version,
			(result) => {
				console.log(`[update] Bridge v${result.latestVersion} available (current: v${result.currentVersion})`);
				void (async () => {
					const ocRunning = opencodeConnector ? await opencodeConnector.isRunning().catch(() => false) : false;
					bridgeServer?.broadcast({
						type: "status",
						data: {
							opencodeRunning: ocRunning,
							updateAvailable: true,
							latestVersion: result.latestVersion,
							currentVersion: result.currentVersion,
						},
					});
				})();
			},
			(msg) => console.log(msg),
		);
	}
}

void main();
