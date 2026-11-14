import type { BridgeLogger } from "../logging/logger";

export type LeveledLogger = {
	logUser: (message: string) => void;
	logInfo: (message: string) => void;
	logDebug: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
};

/**
 * The server's log calls, through the `BridgeLogger` (which redacts and filters console output itself) when there
 * is one. Without one, as in tests, only errors are printed.
 */
export function createLeveledLogger(bridge: BridgeLogger | undefined): LeveledLogger {
	const logError = (message: string, ...args: unknown[]): void => {
		if (bridge) {
			bridge.error(message, ...args);
			return;
		}
		console.error(message, ...args);
	};
	return {
		logUser: (message) => bridge?.user(message),
		logInfo: (message) => bridge?.info(message),
		logDebug: (message) => bridge?.debug(message),
		logError,
	};
}
