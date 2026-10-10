import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AuthTokenState, BridgeServer, BridgeServerOptions } from "../../src/server";
import { requireIsolatedBenchHome } from "./bench-home";

export const BENCH_TOKEN = "bench-token-0000000000000000";

export type BenchServerHandle = {
	server: BridgeServer;
	port: number;
	token: string;
	homedirObserved: string;
	envHome: string;
	configPath: string;
	broskiDirCreated: () => boolean;
	stop: () => void;
};

export async function startBenchServer(): Promise<BenchServerHandle> {
	requireIsolatedBenchHome();
	process.env.BROSKI_TLS = "0";

	const { createBridgeServer } = await import("../../src/server");
	const { getConfigPath } = await import("../../src/config/read-write");
	const { homedir } = await import("node:os");

	const auth: AuthTokenState = {
		version: 1,
		token: BENCH_TOKEN,
		createdAt: Date.now(),
		expiresAt: Date.now() + 24 * 60 * 60 * 1000,
	};
	const options: BridgeServerOptions = { port: 0, opencode: null, version: "0.0.0-bench", auth };
	const server = await createBridgeServer(options);
	const homeDir = homedir();

	return {
		server,
		port: server.port(),
		token: server.authToken(),
		homedirObserved: homeDir,
		envHome: process.env.HOME ?? "",
		configPath: getConfigPath(),
		broskiDirCreated: () => existsSync(join(homeDir, ".broski")),
		stop: () => server.stop(true),
	};
}
