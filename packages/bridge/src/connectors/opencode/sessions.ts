import type { PermissionRuleset, SessionStatusInfo, SessionSummary } from "../../types";
import type { OpenCodeContext } from "./context";
import { mapSession } from "./mappers";
import {
	listOpenCodeSessionsInternal,
	listOpenCodeSessionsWithCache,
	type OpenCodeSessionListOptions,
} from "./session-list";

export async function listSessions(
	ctx: OpenCodeContext,
	directory?: string,
	options?: OpenCodeSessionListOptions,
): Promise<SessionSummary[]> {
	return listOpenCodeSessionsWithCache({
		directory,
		options,
		sessionCache: ctx.sessionCache,
		cacheTtlMs: ctx.sessionCacheTtlMs,
		listSessionsInternal: (sessionDirectory, sessionOptions) =>
			listOpenCodeSessionsInternal({
				client: ctx.client,
				directory: sessionDirectory,
				options: sessionOptions,
				mapSession,
			}),
	});
}

export function invalidateSessionCache(ctx: OpenCodeContext, directory?: string): void {
	if (directory) {
		ctx.sessionCache.delete(directory);
	}
	ctx.sessionCache.delete("__all__");
}

export async function createSession(
	ctx: OpenCodeContext,
	directory?: string,
	title?: string,
	permission?: PermissionRuleset,
	workspaceID?: string,
): Promise<SessionSummary> {
	const body: Record<string, unknown> = {};
	if (title && title.length > 0) body.title = title;
	if (permission && permission.length > 0) body.permission = permission;
	if (workspaceID) body.workspaceID = workspaceID;

	const { data: session } = await ctx.client.session.create({
		directory,
		...(Object.keys(body).length > 0 ? body : {}),
	});
	return mapSession(session!);
}

export async function getSession(ctx: OpenCodeContext, sessionId: string, directory?: string): Promise<SessionSummary> {
	const { data: session } = await ctx.client.session.get({ sessionID: sessionId, directory });
	return mapSession(session!);
}

export async function abortSession(ctx: OpenCodeContext, sessionId: string, directory?: string): Promise<boolean> {
	const { data } = await ctx.client.session.abort({ sessionID: sessionId, directory });
	return data === true;
}

export async function deleteSession(ctx: OpenCodeContext, sessionId: string, directory?: string): Promise<boolean> {
	try {
		await ctx.client.session.delete({ sessionID: sessionId, directory });
		return true;
	} catch {
		return false;
	}
}

export async function updateSession(
	ctx: OpenCodeContext,
	sessionId: string,
	title?: string,
	archived?: boolean,
	directory?: string,
): Promise<SessionSummary> {
	const { data: session } = await ctx.client.session.update({
		sessionID: sessionId,
		directory,
		...(title ? { title } : {}),
		...(archived !== undefined ? { time: { archived: archived ? Date.now() : undefined } } : {}),
	});
	return mapSession(session!);
}

export async function forkSession(
	ctx: OpenCodeContext,
	sessionId: string,
	messageId?: string,
	directory?: string,
): Promise<SessionSummary> {
	const { data: session } = await ctx.client.session.fork({
		sessionID: sessionId,
		directory,
		...(messageId ? { messageID: messageId } : {}),
	});
	return mapSession(session!);
}

export async function listSessionChildren(
	ctx: OpenCodeContext,
	sessionId: string,
	directory?: string,
): Promise<SessionSummary[]> {
	try {
		const { data: children } = await ctx.client.session.children({ sessionID: sessionId, directory });
		return (children ?? []).map((session) => mapSession(session));
	} catch {
		return [];
	}
}

export async function revertMessage(
	ctx: OpenCodeContext,
	sessionId: string,
	messageId: string,
	partId?: string,
	directory?: string,
): Promise<SessionSummary> {
	const { data: session } = await ctx.client.session.revert({
		sessionID: sessionId,
		directory,
		messageID: messageId,
		...(partId ? { partID: partId } : {}),
	});
	return mapSession(session!);
}

export async function unrevertSession(
	ctx: OpenCodeContext,
	sessionId: string,
	directory?: string,
): Promise<SessionSummary> {
	const { data: session } = await ctx.client.session.unrevert({ sessionID: sessionId, directory });
	return mapSession(session!);
}

export async function shareSession(
	ctx: OpenCodeContext,
	sessionId: string,
	directory?: string,
): Promise<SessionSummary> {
	const { data: session } = await ctx.client.session.share({ sessionID: sessionId, directory });
	return mapSession(session!);
}

export async function unshareSession(
	ctx: OpenCodeContext,
	sessionId: string,
	directory?: string,
): Promise<SessionSummary> {
	const { data: session } = await ctx.client.session.unshare({ sessionID: sessionId, directory });
	return mapSession(session!);
}

export async function summarizeSession(
	ctx: OpenCodeContext,
	sessionId: string,
	providerID: string,
	modelID: string,
	directory?: string,
	auto?: boolean,
): Promise<boolean> {
	try {
		await ctx.client.session.summarize({
			sessionID: sessionId,
			directory,
			providerID,
			modelID,
			...(auto !== undefined ? { auto } : {}),
		});
		return true;
	} catch {
		return false;
	}
}

export async function initSession(
	ctx: OpenCodeContext,
	sessionId: string,
	providerID: string,
	modelID: string,
	messageID: string,
	directory?: string,
): Promise<boolean> {
	try {
		await ctx.client.session.init({ sessionID: sessionId, directory, providerID, modelID, messageID });
		return true;
	} catch {
		return false;
	}
}

export async function getSessionStatus(
	ctx: OpenCodeContext,
	directory?: string,
): Promise<Record<string, SessionStatusInfo>> {
	try {
		const { data: result } = await ctx.client.session.status({ directory });
		const mapped: Record<string, SessionStatusInfo> = {};
		for (const [sessionId, status] of Object.entries(result ?? {})) {
			const s = status as { type?: string; attempt?: number; message?: string; next?: number };
			if (s.type === "busy") {
				mapped[sessionId] = { type: "busy" };
			} else if (s.type === "retry") {
				mapped[sessionId] = {
					type: "retry",
					attempt: s.attempt ?? 0,
					message: s.message ?? "",
					next: s.next ?? 0,
				};
			} else {
				mapped[sessionId] = { type: "idle" };
			}
		}
		return mapped;
	} catch {
		return {};
	}
}

export async function getSessionDiff(ctx: OpenCodeContext, sessionId: string, directory?: string, messageId?: string) {
	const { data } = await ctx.client.session.diff({ sessionID: sessionId, directory, messageID: messageId });
	return data;
}
