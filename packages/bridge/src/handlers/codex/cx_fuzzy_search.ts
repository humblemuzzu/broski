import type { CodexAppServerClient } from "../../connectors/codex";
import type { CxMessage } from "../../routing/messages";

type CxFuzzySearchContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (v: unknown) => string;
	cxThreadCwds: Map<string, string>;
	// Active search sessions - maps sessionId to threadId for cleanup
	cxSearchSessions: Map<string, string>;
};

export async function handle(
	message: CxMessage,
	reply: (msg: any) => void,
	ctx: CxFuzzySearchContext,
): Promise<boolean> {
	const { ensureCodexClient, safeString, cxThreadCwds, cxSearchSessions } = ctx;

	switch (message.type) {
		case "cx_fuzzy_search_start": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			const query = safeString(message.query).trim();
			const cwd = message.cwd || cxThreadCwds.get(threadId) || process.cwd();

			if (!query) {
				reply({
					type: "cx_fuzzy_search_results",
					requestId: message.requestId,
					data: { sessionId: "", results: [] },
				});
				break;
			}

			try {
				const result: any = await client.request("fuzzyFileSearch/sessionStart", {
					threadId: threadId || undefined,
					query,
					cwd,
					maxResults: message.maxResults ?? 20,
				});

				const sessionId = result?.sessionId ?? `search_${Date.now()}`;
				if (threadId) cxSearchSessions.set(sessionId, threadId);

				reply({
					type: "cx_fuzzy_search_results",
					requestId: message.requestId,
					data: {
						sessionId,
						results: result?.results ?? result?.data ?? [],
						completed: result?.completed ?? false,
					},
				});
			} catch (error: unknown) {
				// Fallback: simple filesystem-based search when Codex doesn't support fuzzy search
				const results = await fallbackFileSearch(query, cwd);
				const fallbackSessionId = `local_${Date.now()}`;
				if (threadId) cxSearchSessions.set(fallbackSessionId, threadId);
				reply({
					type: "cx_fuzzy_search_results",
					requestId: message.requestId,
					data: { sessionId: fallbackSessionId, results, completed: true },
				});
			}
			break;
		}

		case "cx_fuzzy_search_update": {
			const client = await ensureCodexClient();
			const sessionId = safeString(message.sessionId).trim();
			const query = safeString(message.query).trim();

			if (!sessionId || !query) {
				reply({
					type: "cx_fuzzy_search_results",
					requestId: message.requestId,
					data: { sessionId, results: [], completed: true },
				});
				break;
			}

			try {
				const result: any = await client.request("fuzzyFileSearch/sessionUpdate", {
					sessionId,
					query,
				});

				reply({
					type: "cx_fuzzy_search_results",
					requestId: message.requestId,
					data: {
						sessionId,
						results: result?.results ?? result?.data ?? [],
						completed: result?.completed ?? false,
					},
				});
			} catch (error: unknown) {
				// If update fails, try a new search
				const threadId = cxSearchSessions.get(sessionId);
				const cwd = threadId ? cxThreadCwds.get(threadId) : undefined;
				const results = await fallbackFileSearch(query, cwd || process.cwd());
				reply({
					type: "cx_fuzzy_search_results",
					requestId: message.requestId,
					data: { sessionId, results, completed: true },
				});
			}
			break;
		}

		case "cx_fuzzy_search_end": {
			const client = await ensureCodexClient();
			const sessionId = safeString(message.sessionId).trim();

			if (sessionId) {
				cxSearchSessions.delete(sessionId);
				try {
					await client.request("fuzzyFileSearch/sessionEnd", { sessionId });
				} catch {
					// Best-effort cleanup
				}
			}

			reply({
				type: "cx_fuzzy_search_ended",
				requestId: message.requestId,
				data: { ok: true },
			});
			break;
		}

		default:
			return false;
	}
	return true;
}

/**
 * Fallback file search using `find` command when Codex fuzzy search isn't available.
 */
async function fallbackFileSearch(
	query: string,
	cwd: string,
): Promise<Array<{ path: string; name: string; score: number }>> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		// Use find + grep for basic fuzzy matching
		const proc = spawn(
			"find",
			[
				".",
				"-type",
				"f",
				"-not",
				"-path",
				"*/.git/*",
				"-not",
				"-path",
				"*/node_modules/*",
				"-not",
				"-path",
				"*/.dart_tool/*",
				"-not",
				"-path",
				"*/build/*",
				"-name",
				`*${query}*`,
			],
			{ cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 5000 },
		);

		let stdout = "";
		proc.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});

		proc.on("close", () => {
			const results = stdout
				.split("\n")
				.filter(Boolean)
				.slice(0, 20)
				.map((path, i) => {
					const clean = path.replace(/^\.\//, "");
					const parts = clean.split("/");
					return {
						path: clean,
						name: parts[parts.length - 1] ?? clean,
						score: 1 - i * 0.03, // Decreasing score
					};
				});
			resolve(results);
		});

		proc.on("error", () => resolve([]));
	});
}
