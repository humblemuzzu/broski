import { createShutdownController } from "../lifecycle/shutdown-guard";
import { logDaemon } from "../logging/daemon-log";
import { stopPeriodicUpdateCheck } from "../updater";
import { serveState } from "./state";

async function runShutdown(signal: string, _exitCode = 0): Promise<void> {
	logDaemon(`\n${signal} received. Shutting down...`);

	stopPeriodicUpdateCheck();

	if (serveState.bridgeServer) {
		logDaemon("Stopping bridge server...");
		await serveState.bridgeServer.stop(true);
		serveState.bridgeServer = null;
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
