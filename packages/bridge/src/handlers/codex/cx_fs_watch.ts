import type { ServerWebSocket } from "bun";
import type { CodexAppServerClient } from "../../connectors/codex";

type CxFsWatchContext = {
	ws: ServerWebSocket<unknown>;
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (v: unknown) => string;
};

type ActiveWatch = { paths: string[]; threadId?: string; socket: ServerWebSocket<unknown> };

// Active watch subscriptions, each owned by the socket that asked for it.
const activeWatches = new Map<string, ActiveWatch>();

export function activeWatchCount(): number {
	return activeWatches.size;
}

/** Drops the watches a closed socket owned, so a reconnect cannot leak subscriptions. */
export function detach(ws: ServerWebSocket<unknown>, client: CodexAppServerClient | null): void {
	for (const [subscriptionId, watch] of activeWatches) {
		if (watch.socket !== ws) continue;
		activeWatches.delete(subscriptionId);
		void client?.request("fs/unwatch", { subscriptionId }).catch(() => {});
	}
}

export async function handle(message: any, reply: (msg: any) => void, ctx: CxFsWatchContext): Promise<boolean> {
	const { ensureCodexClient, safeString } = ctx;

	switch (message.type) {
		case "cx_fs_watch": {
			const client = await ensureCodexClient();
			const paths = Array.isArray(message.paths) ? message.paths.map(String) : [];
			const threadId = safeString(message.threadId).trim() || undefined;

			if (paths.length === 0) {
				reply({
					type: "cx_fs_watched",
					requestId: message.requestId,
					data: { subscriptionId: "", ok: false, error: "No paths provided" },
				});
				break;
			}

			try {
				const result: any = await client.request("fs/watch", { paths });
				const subscriptionId = result?.subscriptionId ?? `watch_${Date.now()}`;
				activeWatches.set(subscriptionId, { paths, threadId, socket: ctx.ws });
				reply({
					type: "cx_fs_watched",
					requestId: message.requestId,
					data: { subscriptionId, ok: true },
				});
			} catch (error: unknown) {
				reply({
					type: "cx_fs_watched",
					requestId: message.requestId,
					data: {
						subscriptionId: "",
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
			break;
		}

		case "cx_fs_unwatch": {
			const subscriptionId = safeString(message.subscriptionId).trim();

			if (!subscriptionId) {
				reply({
					type: "cx_fs_unwatched",
					requestId: message.requestId,
					data: { ok: false, error: "No subscriptionId provided" },
				});
				break;
			}

			const client = await ensureCodexClient();

			try {
				await client.request("fs/unwatch", { subscriptionId });
				activeWatches.delete(subscriptionId);
				reply({
					type: "cx_fs_unwatched",
					requestId: message.requestId,
					data: { ok: true },
				});
			} catch {
				activeWatches.delete(subscriptionId);
				reply({
					type: "cx_fs_unwatched",
					requestId: message.requestId,
					data: { ok: true }, // Best-effort cleanup succeeds
				});
			}
			break;
		}

		default:
			return false;
	}
	return true;
}
