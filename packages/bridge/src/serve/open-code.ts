import { spawnSync } from "node:child_process";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { logDaemon, logDaemonError } from "../logging/daemon-log";
import { loadOpenCodeSdk } from "../sdk/opencode-sdk";
import { describeOpenCodeProbe, probeOpenCode } from "./open-code-probe";
import type { OpenCodeServer } from "./state";

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
			const probe = await probeOpenCode();
			const unsupported = probe.foreignBanner || probe.binary === null;
			if (attempt < MAX_RETRIES && !unsupported) {
				logDaemon(`  OpenCode not ready (${describeOpenCodeProbe(probe)}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
				await Bun.sleep(RETRY_DELAY_MS);
				continue;
			}
			logDaemonError(`Failed to start managed OpenCode server: ${describeOpenCodeProbe(probe)} (${String(error)})`);
			if (probe.binary === null) {
				logDaemon(
					"  Install OpenCode (curl -fsSL https://opencode.ai/install | bash  or  bun add -g opencode-ai) and restart the bridge",
				);
			}
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
