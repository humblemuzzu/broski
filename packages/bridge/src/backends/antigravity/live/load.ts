/**
 * `session/load`, on the live front of a session the bridge is about to host or on a short job that reads its history:
 * agy replays the session as `session/update`s before it answers, so all of it has arrived by then.
 */

import type { z } from "zod";
import { LoadSessionResult, type SessionUpdate } from "../acp/frames";
import type { JsonRpc, RpcResult } from "../acp/rpc";
import { jobRoute } from "../jobs";
import { ReplayItems } from "../store/transcript-items";

/** What a load replays besides history that the live session keeps: its context fill, commands and title. */
const SESSION_FACTS = new Set(["usage_update", "available_commands_update", "session_info_update"]);

export interface LoadParams {
	readonly sessionId: string;
	readonly cwd: string;
	readonly mcpServers: readonly [];
}

export interface Loaded {
	readonly loaded: RpcResult<z.infer<typeof LoadSessionResult>>;
	/** The replay's facts, for a host. */
	readonly facts: readonly SessionUpdate[];
	/** The replay's history. */
	readonly history: ReplayItems;
}

export async function loadSession(rpc: JsonRpc, params: LoadParams): Promise<Loaded> {
	const facts: SessionUpdate[] = [];
	const history = new ReplayItems();
	const detach = rpc.attach(
		params.sessionId,
		jobRoute(
			(update) => {
				if (SESSION_FACTS.has(update.sessionUpdate)) facts.push(update);
				else history.add(update);
			},
			() => history.fault(),
		),
	);
	const loaded = await rpc.request("session/load", params, LoadSessionResult);
	detach();
	return { loaded, facts, history };
}
