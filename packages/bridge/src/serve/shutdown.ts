import { createShutdownController } from "../lifecycle/shutdown-guard";
import { logDaemon, logDaemonError } from "../logging/daemon-log";
import { stopPeriodicUpdateCheck } from "../updater";
import { bootstrapManagedOpenCode } from "./open-code";
import {
	FAILURES_TO_TRIGGER_RESTART,
	MAX_RESTARTS,
	RESTART_COOLDOWN_MS,
	serveState,
	subscribeOpenCodeStream,
} from "./state";

async function runShutdown(signal: string, _exitCode = 0): Promise<void> {
	logDaemon(`\n${signal} received. Shutting down...`);

	stopPeriodicUpdateCheck();

	if (serveState.healthTimer) {
		clearInterval(serveState.healthTimer);
		serveState.healthTimer = null;
	}

	if (serveState.primaryEventStreamController || serveState.extraEventStreamControllers.length > 0) {
		logDaemon("Stopping OpenCode event streams...");
		if (serveState.primaryEventStreamController) {
			serveState.primaryEventStreamController.abort();
			serveState.primaryEventStreamController = null;
		}
		while (serveState.extraEventStreamControllers.length > 0) {
			serveState.extraEventStreamControllers.pop()?.abort();
		}
	}

	if (serveState.bridgeServer) {
		logDaemon("Stopping bridge server...");
		await serveState.bridgeServer.stop(true);
		serveState.bridgeServer = null;
	}

	if (serveState.opencodeServer && "close" in serveState.opencodeServer) {
		logDaemon("Stopping managed OpenCode server...");
		await serveState.opencodeServer.close();
		serveState.opencodeServer = null;
	} else if (serveState.opencodeServer) {
		logDaemon("OpenCode server is external - leaving it running");
	}

	if (serveState.activeBridgeLogger) {
		await serveState.activeBridgeLogger.flush().catch(() => {});
	}

	logDaemon("Shutdown complete. Goodbye!");
}

export const shutdown = createShutdownController({
	run: runShutdown,
	exit: (code) => process.exit(code),
});

export async function restartManagedOpenCode(): Promise<boolean> {
	if (serveState.restartInFlight) return false;
	if (!serveState.opencodeServer || !("close" in serveState.opencodeServer)) return false;
	if (!serveState.opencodeConnector) return false;

	serveState.restartInFlight = true;
	try {
		logDaemon("Restarting managed OpenCode...");

		if (serveState.primaryEventStreamController) {
			serveState.primaryEventStreamController.abort();
			serveState.primaryEventStreamController = null;
		}

		try {
			await serveState.opencodeServer.close();
		} catch {
			// ignore
		}

		const bootstrap = await bootstrapManagedOpenCode(
			serveState.managedHostname,
			serveState.managedPort,
			serveState.verboseMode,
		);
		serveState.opencodeServer = bootstrap.server;

		serveState.opencodeConnector.updateBaseUrl(serveState.opencodeServer.url);

		serveState.primaryEventStreamController = await subscribeOpenCodeStream(
			serveState.opencodeConnector,
			"primary",
			serveState.verboseMode,
		);

		serveState.bridgeServer?.broadcast({ type: "status", data: { opencodeRunning: true } });
		serveState.consecutiveHealthFailures = 0;
		logDaemon("✓ OpenCode restarted");
		return true;
	} catch (error) {
		logDaemonError(`Failed to restart OpenCode: ${String(error)}`);
		serveState.bridgeServer?.broadcast({ type: "status", data: { opencodeRunning: false } });
		return false;
	} finally {
		serveState.restartInFlight = false;
	}
}

/** Managed mode: keep OpenCode alive with a conservative restart policy. */
export function startOpenCodeHealthMonitor(): void {
	if (!serveState.opencodeServer || !("close" in serveState.opencodeServer)) return;

	serveState.healthTimer = setInterval(() => {
		void (async () => {
			if (!serveState.opencodeConnector) return;
			if (serveState.restartInFlight) return;
			if (Date.now() - serveState.lastRestartTime < RESTART_COOLDOWN_MS) return;

			const ok = await serveState.opencodeConnector.isRunning();
			if (ok) {
				serveState.consecutiveHealthFailures = 0;
				return;
			}

			serveState.consecutiveHealthFailures++;
			if (serveState.consecutiveHealthFailures < FAILURES_TO_TRIGGER_RESTART) {
				logDaemon(
					`[health] OpenCode not responding (${serveState.consecutiveHealthFailures}/${FAILURES_TO_TRIGGER_RESTART})`,
				);
				return;
			}
			serveState.consecutiveHealthFailures = 0;

			if (serveState.restartCount >= MAX_RESTARTS) {
				logDaemonError(`[health] OpenCode has restarted ${MAX_RESTARTS} times — automatic restarts disabled`);
				if (serveState.healthTimer) {
					clearInterval(serveState.healthTimer);
					serveState.healthTimer = null;
				}
				return;
			}

			serveState.restartCount++;
			serveState.lastRestartTime = Date.now();
			serveState.bridgeServer?.broadcast({ type: "status", data: { opencodeRunning: false } });
			await restartManagedOpenCode();
		})();
	}, 30_000);
}
