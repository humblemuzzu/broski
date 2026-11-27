/** One session's `SDKSessionInfo`, where its file is (`StoredSession`), and its row. */

import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { isRejected, rejected } from "../../../adapter-kit/rejections";
import type { Rejected, SessionId, SessionSummary } from "../../../contract";
import type { LiveRow, StoredSession } from "../ports/store";
import type { StoreContext } from "./context";
import { attempt } from "./guard";
import { sessionRow } from "./rows";

/** The SDK's lite read of one session: undefined for an unknown id, a sidechain, or a file with no summary. */
export async function sessionInfo(
	ctx: StoreContext,
	sessionId: SessionId,
): Promise<SDKSessionInfo | undefined | Rejected> {
	return attempt(() => ctx.deps.services.sdk.getSessionInfo(sessionId));
}

export async function locateSession(ctx: StoreContext, sessionId: SessionId): Promise<StoredSession | Rejected> {
	const info = await sessionInfo(ctx, sessionId);
	if (info !== undefined && isRejected(info)) return info;
	const path = info === undefined ? undefined : await ctx.locator.find(sessionId);
	if (info === undefined || path === undefined) return rejected("not_found", `no Claude Code session ${sessionId}`);
	return {
		sessionId,
		cwd: info.cwd,
		path,
		origin: ctx.deps.ownership.origin(sessionId),
		lastModified: info.lastModified,
	};
}

/**
 * The row of a session the SDK described: its origin from the journal, its fork link, the hosted facts laid over.
 * `known`, when the caller knows the transcript's path, spares a search of the project directories.
 */
export async function rowOfInfo(
	ctx: StoreContext,
	info: SDKSessionInfo,
	live: LiveRow | undefined,
	known?: string,
): Promise<SessionSummary | undefined> {
	const forkOf = await ctx.forks.parentOf(info.sessionId);
	const titled = info.customTitle !== undefined && info.customTitle !== "";
	const path = known ?? (await ctx.locator.find(info.sessionId));
	const active = live?.status === "running" || live?.status === "waiting_for_user";
	const runStartedAt =
		active && live?.runStartedAt === undefined && path !== undefined ? await ctx.activity.promptAt(path) : undefined;
	return sessionRow(info, {
		origin: ctx.deps.ownership.origin(info.sessionId),
		updatedAt: path === undefined ? undefined : await ctx.activity.updatedAt(path),
		...(runStartedAt !== undefined && { runStartedAt }),
		userTitled: titled && (await ctx.titles.userTitled(info.sessionId, path)),
		...(live !== undefined && { live }),
		...(forkOf !== undefined && {
			parent: {
				kind: "fork",
				session: { backend: "claude-code", sessionId: forkOf },
			},
		}),
	});
}
