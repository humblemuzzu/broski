import { spawnSync } from "node:child_process";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { promptForChoice } from "../cli";
import { logDaemon, logDaemonError } from "../logging/daemon-log";
import { IS_WINDOWS } from "../platform";
import { loadOpenCodeSdk } from "../sdk/opencode-sdk";
import type { OpenCodeServer } from "./state";

export type OpenCodeInstance = {
	port: number;
	url: string;
	projects: Array<{ id: string; worktree: string; time?: { created?: number; updated?: number } }>;
	lastActivity: number;
};

export type OpencodeBootstrap = {
	server: OpenCodeServer;
	client?: OpencodeClient;
};

export async function waitForOpencodeReady(url: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${url}/path`, { signal: AbortSignal.timeout(750) });
			if (res.ok) return true;
		} catch {
			// keep retrying
		}
		await Bun.sleep(150);
	}
	return false;
}

export async function discoverRunningOpencodeInstances(
	portsToScan: number[],
	verbose: boolean,
): Promise<OpenCodeInstance[]> {
	if (verbose) {
		console.log("Scanning for running OpenCode instances...");
	}

	const instances: OpenCodeInstance[] = [];

	// Limit concurrency so a large port range does not flood the system with parallel connections.
	const queue = portsToScan.slice();
	const concurrency = 32;
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			for (;;) {
				const port = queue.shift();
				if (port == null) return;
				try {
					const url = `http://127.0.0.1:${port}`;
					const ready = await fetch(`${url}/path`, { signal: AbortSignal.timeout(750) });
					if (!ready.ok) continue;

					let projects: OpenCodeInstance["projects"] = [];
					try {
						const response = await fetch(`${url}/project`, { signal: AbortSignal.timeout(750) });
						if (response.ok) {
							projects = (await response.json()) as OpenCodeInstance["projects"];
						}
					} catch {
						// Best-effort: older/newer versions may not expose this endpoint.
					}

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

	instances.sort((a, b) => b.lastActivity - a.lastActivity);
	return instances;
}

export async function bootstrapManagedOpenCode(
	hostname: string,
	port: number,
	verbose: boolean,
): Promise<OpencodeBootstrap> {
	const MAX_RETRIES = 3;
	const RETRY_DELAY_MS = 3000;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		logDaemon(`Starting OpenCode (managed)...${attempt > 1 ? ` (attempt ${attempt}/${MAX_RETRIES})` : ""}`);
		try {
			const { createOpencode } = await loadOpenCodeSdk();
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
				logDaemon(`✓ OpenCode ready at ${server.url}`);
			} else {
				logDaemon("✓ OpenCode ready");
			}

			return {
				client,
				server: {
					url: server.url,
					close: async () => {
						try {
							server.close();
							logDaemon("  Managed OpenCode server stopped");
						} catch (error) {
							logDaemonError(`  Error stopping managed OpenCode server: ${String(error)}`);
						}
					},
				},
			};
		} catch (error) {
			if (attempt < MAX_RETRIES) {
				logDaemon(`  OpenCode not ready, retrying in ${RETRY_DELAY_MS / 1000}s...`);
				await Bun.sleep(RETRY_DELAY_MS);
				continue;
			}
			logDaemonError(`Failed to start managed OpenCode server after all retries: ${String(error)}`);
			logDaemon(
				"  Ensure OpenCode is installed and on PATH (install: curl -fsSL https://opencode.ai/install | bash  or  bun add -g opencode-ai)",
			);
			throw error;
		}
	}

	throw new Error("Unreachable");
}

export async function bootstrapManualOpenCode(url: string): Promise<OpencodeBootstrap> {
	logDaemon(`Attaching to OpenCode (manual): ${url}`);
	const ready = await waitForOpencodeReady(url, 5000);
	if (!ready) {
		logDaemon("⚠️  OpenCode is not responding at the provided URL.");
	} else {
		logDaemon("✓ OpenCode is responding");
	}
	return {
		server: { url, managed: false },
	};
}

export function defaultAttachPorts(): number[] {
	// We only scan in explicit --attach mode (power users).
	// Default range covers the most common ports observed in practice.
	const ports: number[] = [4096];
	for (let i = 0; i < 256; i++) ports.push(64864 + i);
	for (let i = 0; i < 256; i++) ports.push(49152 + i);
	return ports;
}

export function discoverListeningPortsFromLsof(verbose: boolean): number[] {
	try {
		if (IS_WINDOWS) {
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
			logDaemon(`Port scan failed (continuing without it): ${String(err)}`);
		}
		return [];
	}
}

export function isOpencodeCliAvailable(verbose: boolean): boolean {
	try {
		// Fast PATH check to avoid slow retries when OpenCode isn't installed.
		const res = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 1500 });
		if (res.error) {
			if (verbose) {
				logDaemon(`OpenCode CLI check failed: ${String(res.error)}`);
			}
			return false;
		}
		return res.status === 0;
	} catch (err) {
		if (verbose) {
			logDaemon(`OpenCode CLI check threw: ${String(err)}`);
		}
		return false;
	}
}

export async function bootstrapAttachOpenCode(verbose: boolean): Promise<OpencodeBootstrap> {
	const lsofPorts = discoverListeningPortsFromLsof(verbose);
	const ports = Array.from(new Set([...defaultAttachPorts(), ...lsofPorts]));
	const instances = await discoverRunningOpencodeInstances(ports, verbose);
	if (instances.length === 0) {
		logDaemon("No running OpenCode servers found.");
		logDaemon("  Start one: `opencode serve`");
		logDaemon("  Or attach explicitly: `broski --opencode-url http://127.0.0.1:4096`");
		throw new Error("No running OpenCode servers found");
	}

	if (instances.length === 1) {
		const inst = instances[0]!;
		logDaemon(`✓ Found OpenCode at ${inst.url}`);
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
	logDaemon(`✓ Using OpenCode at ${inst.url}`);
	return { server: { url: inst.url, managed: false } };
}

export async function discoverLocalOpencodeUrls(verbose: boolean): Promise<string[]> {
	const ports = discoverListeningPortsFromLsof(verbose);
	if (ports.length === 0) return [];
	const instances = await discoverRunningOpencodeInstances(ports, false);
	return instances.map((i) => i.url);
}
