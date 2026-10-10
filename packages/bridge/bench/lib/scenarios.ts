export type ScenarioSpec = { name: string; description: string; needsTempHome?: boolean };

export const SCENARIOS: ScenarioSpec[] = [
	{ name: "startup-version", description: "spawn `bun src/index.ts version` -> exit" },
	{ name: "module-load", description: "import ../src/server.ts, no server started" },
	{ name: "pi-list-sessions-cold", description: "pi.listSessions() with a cold session-list cache" },
	{ name: "pi-list-sessions-warm", description: "pi.listSessions() twice in one process" },
	{ name: "pi-list-projects", description: "pi.listProjects()" },
	{
		name: "pi-read-largest-transcript",
		description: "pi_read_session_messages path on the largest session, limit 200",
	},
	{ name: "codex-list-projects", description: "cx_list_projects path: listProjectsFromFs + sqlite fallback" },
	{ name: "codex-list-threads", description: "cx_list_threads sqlite path" },
	{ name: "codex-enrich-stats", description: "enrichThreadsWithStats over the 200 newest threads" },
	{ name: "codex-read-largest-transcript", description: "getThreadMessagesFromFs on the largest rollout" },
	{ name: "cc-list-sessions", description: "claude-code listSessions() across all projects" },
	{ name: "cc-list-projects", description: "claude-code listProjects()" },
	{ name: "cc-read-largest-transcript", description: "getSessionMessages on the largest CC session, limit 200" },
	{
		name: "server-idle",
		description: "createBridgeServer on a random port (TLS off, temp HOME), 1 client, 60 s idle",
		needsTempHome: true,
	},
	{
		name: "stream-throughput",
		description: "20k synthetic runtime text deltas to 1 and 4 clients",
		needsTempHome: true,
	},
];

export const SELFTEST: ScenarioSpec = {
	name: "zz-selftest-alloc",
	description: "allocates past a 200 MB cap to prove the runner kills it",
};
