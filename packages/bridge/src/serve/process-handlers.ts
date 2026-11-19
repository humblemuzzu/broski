export type SignalTarget = {
	on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

export type ShutdownHooks = {
	request: (signal: string) => void;
	fatal: (label: string, error: unknown) => void;
};

/**
 * Wires the serve process's signal and fatal-error handlers. Kept apart from serve.ts so the wiring
 * can be exercised against a recording target instead of the real process.
 */
export function installProcessHandlers(shutdown: ShutdownHooks, target: SignalTarget = process): void {
	target.on("SIGINT", () => shutdown.request("SIGINT"));
	target.on("SIGTERM", () => shutdown.request("SIGTERM"));
	target.on("SIGTSTP", () => shutdown.request("SIGTSTP"));
	target.on("unhandledRejection", (reason) => shutdown.fatal("Unhandled promise rejection", reason));
	target.on("uncaughtException", (error) => shutdown.fatal("Uncaught exception", error));
}
