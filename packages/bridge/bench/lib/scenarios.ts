export type ScenarioSpec = {
	name: string;
	description: string;
	needsTempHome?: boolean;
	/** Dataset ids this scenario reads; the runner skips it when any is missing (e.g. in CI). */
	requiresDatasets?: string[];
};

export const SCENARIOS: ScenarioSpec[] = [
	{ name: "startup-version", description: "spawn `bun src/index.ts version` -> exit" },
	{ name: "module-load", description: "import ../src/server.ts, no server started" },
	{
		name: "server-idle",
		description: "createBridgeServer on a random port (TLS off, temp HOME), 60 s idle (BENCH_SERVER_IDLE_MS)",
		needsTempHome: true,
	},
	{
		name: "pty-main-thread-stall",
		description: "3 idle native PTY sessions (BENCH_PTY_SESSIONS): JS-thread yield p99 plus an echo round trip",
		needsTempHome: true,
	},
];

export const SELFTEST: ScenarioSpec = {
	name: "zz-selftest-alloc",
	description: "allocates past a 200 MB cap to prove the runner kills it",
};
