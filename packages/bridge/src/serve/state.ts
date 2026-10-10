import type { OpenCodeConnector } from "../connectors/opencode";
import { logDaemon } from "../logging/daemon-log";
import type { BridgeLogger } from "../logging/logger";
import type { BridgeServer } from "../server";

export type ManagedOpenCodeServer = {
	url: string;
	close: () => Promise<void>;
};

export type ManualOpenCodeServer = {
	url: string;
	managed: false;
};

export type OpenCodeServer = ManagedOpenCodeServer | ManualOpenCodeServer;

export const MAX_RESTARTS = 10;
export const RESTART_COOLDOWN_MS = 30_000;
export const FAILURES_TO_TRIGGER_RESTART = 3;

export const serveState = {
	opencodeServer: null as OpenCodeServer | null,
	bridgeServer: null as BridgeServer | null,
	primaryEventStreamController: null as AbortController | null,
	extraEventStreamControllers: [] as AbortController[],
	healthTimer: null as Timer | null,
	opencodeConnector: null as OpenCodeConnector | null,
	restartInFlight: false,
	restartCount: 0,
	lastRestartTime: 0,
	consecutiveHealthFailures: 0,
	activeBridgeLogger: null as BridgeLogger | null,
	managedHostname: "127.0.0.1",
	managedPort: 0,
	verboseMode: false,
};

export async function subscribeOpenCodeStream(
	opencode: OpenCodeConnector,
	label: string,
	verbose: boolean,
): Promise<AbortController> {
	const controller = await opencode.startEventStream((event) => {
		if (verbose) {
			logDaemon(`[SDK Event] ${JSON.stringify(event)}`);
		}
		serveState.bridgeServer?.enqueueSdkEvent(event);
	});
	if (verbose) {
		logDaemon(`✓ Subscribed to OpenCode events (${label}): ${opencode.url}`);
	}
	return controller;
}
