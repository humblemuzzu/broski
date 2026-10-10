export type ShutdownController = {
	/** Runs the shutdown once; later calls join the in-flight run. */
	request: (signal: string, exitCode?: number) => Promise<void>;
	/** Logs a fatal error with its stack (once), then runs the same shutdown with exit code 1. */
	fatal: (label: string, error: unknown, exitCode?: number) => Promise<void>;
};

export type ShutdownControllerOptions = {
	run: (signal: string, exitCode: number) => Promise<void>;
	exit: (code: number) => void;
	log: (message: string) => void;
};

export function createShutdownController(options: ShutdownControllerOptions): ShutdownController {
	let inFlight: Promise<void> | null = null;
	let fatalLogged = false;

	const request = (signal: string, exitCode = 0): Promise<void> => {
		if (inFlight) return inFlight;
		inFlight = (async () => {
			try {
				await options.run(signal, exitCode);
			} catch (error) {
				options.log(`[FATAL] Shutdown failed: ${describe(error)}`);
			} finally {
				options.exit(exitCode);
			}
		})();
		return inFlight;
	};

	return {
		request,
		fatal: (label, error, exitCode = 1) => {
			if (!fatalLogged) {
				fatalLogged = true;
				options.log(`[FATAL] ${label}: ${describe(error)}`);
			}
			return request(label, exitCode);
		},
	};
}

function describe(error: unknown): string {
	if (error instanceof Error) return error.stack ?? error.message;
	return String(error);
}
