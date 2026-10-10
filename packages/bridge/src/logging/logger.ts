/**
 * Leveled bridge logger.
 *
 * - **user**  — always printed to console (bridge started, client connected, critical events)
 * - **info**  — printed in dev, suppressed in compiled binary console (auth details, cache, lifecycle)
 * - **debug** — printed only with --verbose / BROSKI_DEBUG in dev (RTS internals, filters, etc.)
 * - **error** — always printed to console (stderr) + written to error log
 *
 * ALL levels are always written to the log file so `broski logs` has full data.
 *
 * Daemon mode (launchd) redirects stdout/stderr to bridge.log / bridge.error.log.
 * When that happens, we skip direct file writes to avoid double entries.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import { isCompiledBinary } from "../platform";
import { redactSensitiveText } from "./redact";
import { isFdRedirectedToFile } from "./redirect-detect";
import { RotatingFileWriter } from "./rotating-file";

export const DEFAULT_LOG_DIR = resolve(homedir(), ".broski", "logs");
const PRIMARY_LOG_NAME = "bridge.log";
const ERROR_LOG_NAME = "bridge.error.log";

export type LogLevel = "user" | "info" | "debug";

export interface BridgeLogger {
	/** Always visible on console. Use for: bridge started, client connected/disconnected, critical events. */
	user(message: string): void;
	/** Visible in dev console, hidden in binary console. Always in log file. */
	info(message: string): void;
	/** Visible only with --verbose/DEBUG in dev. Always in log file. */
	debug(message: string): void;
	/** Always visible on stderr. Goes to error log file too. */
	error(message: string, ...args: unknown[]): void;
	/** Flush and close log file streams. Call on shutdown. */
	flush(): Promise<void>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	user: 0,
	info: 1,
	debug: 2,
};

export type BridgeLoggerOptions = {
	/** Override console filter level. Default: 'user' for binary, 'info' for dev. */
	consoleLevel?: LogLevel;
	/** Force redaction on/off. Default: on for binary, off for dev. */
	redact?: boolean;
	/** Enable debug-level console output (like --verbose). */
	verbose?: boolean;
	/** Directory holding bridge.log and bridge.error.log. Default: ~/.broski/logs. */
	logDir?: string;
	/** Size-based rotation for the log files this logger owns. */
	rotation?: { maxBytes?: number; keep?: number };
	/** Redirect probe; defaults to comparing fstat(fd) with stat(path). */
	redirectProbe?: (fd: number, path: string) => boolean;
};

export function createBridgeLogger(options?: BridgeLoggerOptions): BridgeLogger {
	const compiled = isCompiledBinary();
	const shouldRedact = options?.redact ?? compiled;
	const verbose = options?.verbose ?? false;

	// Console level: binary = user only, dev = info (or debug if verbose)
	const consoleLevel: LogLevel = options?.consoleLevel ?? (compiled ? "user" : verbose ? "debug" : "info");
	const consolePriority = LEVEL_PRIORITY[consoleLevel];

	const logDir = options?.logDir ?? DEFAULT_LOG_DIR;
	const primaryLog = resolve(logDir, PRIMARY_LOG_NAME);
	const errorLog = resolve(logDir, ERROR_LOG_NAME);
	const redirectProbe = options?.redirectProbe ?? isFdRedirectedToFile;

	// A supervisor already writing into these exact files owns them.
	const stdoutOwnsPrimary = redirectProbe(1, primaryLog);
	const stderrOwnsError = redirectProbe(2, errorLog);

	let logWriter: RotatingFileWriter | null = null;
	let errorWriter: RotatingFileWriter | null = null;

	try {
		if (!stdoutOwnsPrimary) logWriter = new RotatingFileWriter({ path: primaryLog, ...options?.rotation });
		if (!stderrOwnsError) errorWriter = new RotatingFileWriter({ path: errorLog, ...options?.rotation });
	} catch {
		// Can't write log files — continue without file logging
	}

	const redact = (msg: string): string => {
		return shouldRedact ? redactSensitiveText(msg) : msg;
	};

	const formatFileLine = (level: string, message: string): string => {
		const ts = new Date().toISOString();
		return `[${ts}] [${level.toUpperCase()}] ${message}\n`;
	};

	const writeToFile = (level: string, message: string, isError = false): void => {
		const formatted = formatFileLine(level, message);
		logWriter?.write(formatted);
		if (isError) errorWriter?.write(formatted);
	};

	const shouldPrintToConsole = (level: LogLevel): boolean => {
		return LEVEL_PRIORITY[level] <= consolePriority;
	};

	return {
		user(message: string) {
			const safe = redact(message);
			writeToFile("user", safe);
			if (shouldPrintToConsole("user")) {
				console.log(safe);
			}
		},

		info(message: string) {
			const safe = redact(message);
			writeToFile("info", safe);
			if (shouldPrintToConsole("info")) {
				console.log(safe);
			}
		},

		debug(message: string) {
			const safe = redact(message);
			writeToFile("debug", safe);
			if (shouldPrintToConsole("debug")) {
				console.log(safe);
			}
		},

		error(message: string, ...args: unknown[]) {
			const safe = redact(message);
			writeToFile("error", safe, true);
			// Errors always go to console
			if (args.length > 0) {
				console.error(safe, ...args);
			} else {
				console.error(safe);
			}
		},

		async flush(): Promise<void> {
			await Promise.all([logWriter?.close() ?? Promise.resolve(), errorWriter?.close() ?? Promise.resolve()]);
		},
	};
}
