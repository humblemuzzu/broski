import type { BridgeLogger } from "../logging/logger";

export type LeveledLogger = {
	/** Backward-compat alias for `logInfo`. */
	log: (message: string) => void;
	logUser: (message: string) => void;
	logInfo: (message: string) => void;
	logDebug: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
};

/**
 * A `BridgeLogger` is used directly (it redacts and filters console output itself); a legacy
 * `logger` callback is wrapped as info-level.
 */
export function createLeveledLogger(options: {
	bridgeLogger?: BridgeLogger;
	logger?: (message: string) => void;
}): LeveledLogger {
	const bridge = options.bridgeLogger;
	const legacyLog = options.logger ? (message: string) => options.logger?.(message) : undefined;

	const logUser = (message: string): void => {
		if (bridge) {
			bridge.user(message);
			return;
		}
		legacyLog?.(message);
	};
	const logInfo = (message: string): void => {
		if (bridge) {
			bridge.info(message);
			return;
		}
		legacyLog?.(message);
	};
	const logDebug = (message: string): void => {
		if (bridge) {
			bridge.debug(message);
			return;
		}
		legacyLog?.(message);
	};
	const logError = (message: string, ...args: unknown[]): void => {
		if (bridge) {
			bridge.error(message, ...args);
			return;
		}
		if (args.length > 0) {
			console.error(message, ...args);
		} else {
			console.error(message);
		}
	};

	return { log: logInfo, logUser, logInfo, logDebug, logError };
}
