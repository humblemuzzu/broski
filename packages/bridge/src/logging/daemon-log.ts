import type { BridgeLogger } from "./logger";

let activeLogger: BridgeLogger | null = null;

/** The logger the lifecycle paths write through once the bridge has one. */
export function setDaemonLogger(logger: BridgeLogger | null): void {
	activeLogger = logger;
}

export function logDaemon(message: string): void {
	const logger = activeLogger;
	if (logger) logger.user(message);
	else console.log(message);
}

export function logDaemonError(message: string, ...args: unknown[]): void {
	const logger = activeLogger;
	if (logger) logger.error(message, ...args);
	else console.error(message, ...args);
}
