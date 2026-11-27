/** `session/load` on the live front, of a session the bridge is about to host. */

import type { z } from "zod";
import { LoadSessionResult, type SessionUpdate } from "../acp/frames";
import type { JsonRpc, RpcResult } from "../acp/rpc";
import { jobRoute } from "../jobs";

/** What a load replays besides history that the live session keeps: its context fill, commands and title. */
const SESSION_FACTS = new Set(["usage_update", "available_commands_update", "session_info_update"]);

export interface LoadParams {
	readonly sessionId: string;
	readonly cwd: string;
	readonly mcpServers: readonly [];
}

export interface Loaded {
	readonly loaded: RpcResult<z.infer<typeof LoadSessionResult>>;
	/** The replay's facts, for the host; its history is the transcript's to read. */
	readonly facts: readonly SessionUpdate[];
}

export async function loadSession(rpc: JsonRpc, params: LoadParams): Promise<Loaded> {
	const facts: SessionUpdate[] = [];
	const detach = rpc.attach(
		params.sessionId,
		jobRoute((update) => {
			if (SESSION_FACTS.has(update.sessionUpdate)) facts.push(update);
		}),
	);
	const loaded = await rpc.request("session/load", params, LoadSessionResult);
	detach();
	return { loaded, facts };
}
