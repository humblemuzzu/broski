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
		name: "codex-list-projects",
		description: "cx_list_projects path: listProjectsFromFs + sqlite fallback",
		requiresDatasets: ["codex-sessions"],
	},
	{ name: "codex-list-threads", description: "cx_list_threads sqlite path", requiresDatasets: ["codex-sessions"] },
	{
		name: "codex-enrich-stats",
		description: "enrichThreadsWithStats over the 200 newest threads",
		requiresDatasets: ["codex-sessions"],
	},
	{
		name: "codex-read-largest-transcript",
		description: "getThreadMessagesFromFs on the largest rollout",
		requiresDatasets: ["codex-sessions"],
	},
	{
		name: "open-chat-codex",
		description:
			"cx_get_thread_messages on the largest rollout: paged open vs the whole transcript (OPEN_CHAT_MODE=legacy)",
		requiresDatasets: ["codex-sessions"],
	},
	{
		name: "cc-list-sessions",
		description: "claude-code listSessions() across all projects",
		requiresDatasets: ["claude-code-projects"],
	},
	{ name: "cc-list-projects", description: "claude-code listProjects()", requiresDatasets: ["claude-code-projects"] },
	{
		name: "cc-read-largest-transcript",
		description: "getSessionMessages on the largest CC session, limit 200",
		requiresDatasets: ["claude-code-projects"],
	},
	{
		name: "cc-parity-real",
		description: "new vs whole-file read paths on real ~/.claude data (read-only), mismatch counts",
		requiresDatasets: ["claude-code-projects"],
	},
	{
		name: "cc-synthetic-list-sessions",
		description: "2000 synthetic sessions + one 300 MB transcript: cold/warm vs whole-file listing",
	},
	{
		name: "cc-synthetic-list-projects",
		description: "synthetic home tree: cached walk cold/warm vs uncached walk",
	},
	{
		name: "server-idle",
		description: "createBridgeServer on a random port (TLS off, temp HOME), 60 s idle (BENCH_SERVER_IDLE_MS)",
		needsTempHome: true,
	},
	{
		name: "stream-throughput",
		description: "20k synthetic runtime text deltas to 1 and 4 clients",
		needsTempHome: true,
	},
	{
		name: "stream-stalled-client",
		description: "200k deltas with one client that stops reading: shed at the limit, healthy client unaffected",
		needsTempHome: true,
	},
	{
		name: "ws-deflate",
		description: "permessage-deflate on/off: wire bytes and CPU for a stream, a session list and lone deltas",
		needsTempHome: true,
	},
	{
		name: "soak-sessions",
		description: "2k session views/switches + runtime events over 60 s (BENCH_SOAK_DURATION_MS), reports state sizes",
		needsTempHome: true,
	},
	{
		name: "pty-main-thread-stall",
		description: "3 idle native PTY sessions (BENCH_PTY_SESSIONS): JS-thread yield p99 plus an echo round trip",
		needsTempHome: true,
	},
];

/** Scenarios that need nothing from the developer's machine; safe on a bare CI runner. */
export const SYNTHETIC_SCENARIOS = [
	"module-load",
	"cc-synthetic-list-sessions",
	"cc-synthetic-list-projects",
	"server-idle",
	"stream-throughput",
	"stream-stalled-client",
	"soak-sessions",
	"pty-main-thread-stall",
];

export const SELFTEST: ScenarioSpec = {
	name: "zz-selftest-alloc",
	description: "allocates past a 200 MB cap to prove the runner kills it",
};
