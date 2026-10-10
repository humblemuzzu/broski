export type ScenarioSpec = { name: string; description: string; needsTempHome?: boolean };

export const SCENARIOS: ScenarioSpec[] = [
	{ name: "startup-version", description: "spawn `bun src/index.ts version` -> exit" },
	{ name: "module-load", description: "import ../src/server.ts, no server started" },
	{
		name: "pi-list-sessions-cold",
		description: "pi.listSessions() with an empty index (temp BROSKI_CACHE_DIR)",
	},
	{
		name: "pi-list-sessions-cold-sdk",
		description: "pi.listSessions() through the SDK's SessionManager.listAll, before/after baseline",
	},
	{ name: "pi-list-sessions-warm", description: "pi.listSessions() twice in one process" },
	{
		name: "pi-list-sessions-restart",
		description: "fresh process with the index present: build, then restart and list",
	},
	{ name: "pi-list-projects", description: "pi.listProjects()" },
	{
		name: "pi-index-parity",
		description: "head-scanning SessionInfo builder vs the SDK on every real session file",
	},
	{
		name: "pi-read-largest-transcript",
		description: "pi_read_session_messages path on the largest session, limit 200",
	},
	{
		name: "pi-transcript-parity",
		description: "bounded Pi transcript read vs the whole-file read on real sessions",
	},
	{ name: "codex-list-projects", description: "cx_list_projects path: listProjectsFromFs + sqlite fallback" },
	{ name: "codex-list-threads", description: "cx_list_threads sqlite path" },
	{ name: "codex-enrich-stats", description: "enrichThreadsWithStats over the 200 newest threads" },
	{ name: "codex-read-largest-transcript", description: "getThreadMessagesFromFs on the largest rollout" },
	{
		name: "open-chat-pi",
		description:
			"pi_read_session_messages on the largest session: paged open vs the whole transcript (OPEN_CHAT_MODE=legacy)",
	},
	{
		name: "open-chat-codex",
		description:
			"cx_get_thread_messages on the largest rollout: paged open vs the whole transcript (OPEN_CHAT_MODE=legacy)",
	},
	{ name: "cc-list-sessions", description: "claude-code listSessions() across all projects" },
	{ name: "cc-list-projects", description: "claude-code listProjects()" },
	{ name: "cc-read-largest-transcript", description: "getSessionMessages on the largest CC session, limit 200" },
	{
		name: "cc-parity-real",
		description: "new vs whole-file read paths on real ~/.claude data (read-only), mismatch counts",
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
		description: "createBridgeServer on a random port (TLS off, temp HOME), 1 client, 60 s idle",
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
		description: "2k session views/switches + runtime events over 60 s, reports state sizes",
		needsTempHome: true,
	},
];

export const SELFTEST: ScenarioSpec = {
	name: "zz-selftest-alloc",
	description: "allocates past a 200 MB cap to prove the runner kills it",
};
