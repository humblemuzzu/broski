import { homedir } from "node:os";
import { resolve } from "node:path";
import { type BroskiConfig, readConfig } from "../config";

export interface DoctorContext {
	config: BroskiConfig;
	port: number;
	paths: {
		home: string;
		bin: string;
		logs: string;
		tls: string;
		tokenFile: string;
		logFile: string;
		errorLogFile: string;
		configFile: string;
	};
}

function parsePort(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	if (parsed < 1 || parsed > 65535) return null;
	return parsed;
}

export async function createDoctorContext(): Promise<DoctorContext> {
	const home = resolve(homedir(), ".broski");
	const config = await readConfig();
	const envPort = parsePort(process.env.BROSKI_PORT);
	const port = envPort ?? config.network.port ?? 18274;

	return {
		config,
		port,
		paths: {
			home,
			bin: resolve(home, "bin"),
			logs: resolve(home, "logs"),
			tls: resolve(home, "tls"),
			tokenFile: resolve(home, "token.json"),
			logFile: resolve(home, "logs", "bridge.log"),
			errorLogFile: resolve(home, "logs", "bridge.error.log"),
			configFile: resolve(home, "config.json"),
		},
	};
}
