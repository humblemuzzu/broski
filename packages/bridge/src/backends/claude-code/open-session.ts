/**
 * `AgentBackend.open`'s routing: a new or stored session to the live sessions (and its cwd to the config watch), a
 * child ref to its parent's host, and a session a terminal is writing to the terminal watch (D28).
 */

import type { OpenResult, OpenTarget, Rejected, SessionId, SessionRef, SessionSink } from "../../contract";
import type { ClaudeCodeParts } from "./backend";
import { parseChildRef } from "./ids";
import { defaultPermissionMode } from "./permission-modes";
import type { StoredSession } from "./ports";
import { isRejected, rejected } from "./rejections";
import { dormantClaudeSnapshot, openPromotableWatch } from "./terminal/promotable-view";

/**
 * A terminal's hook ask can come before the CLI's first flush of a new session's transcript (about 100 ms late, D28),
 * so a session a terminal is writing is looked for this long before it is `not_found`.
 */
const FIRST_FLUSH_MS = 3_000;
const LOOK_AGAIN_MS = 100;

export async function openSession(parts: ClaudeCodeParts, target: OpenTarget, sink: SessionSink): Promise<OpenResult> {
	if (target.kind === "new") {
		const opened = await parts.live.open(target, sink);
		if (!isRejected(opened)) parts.configWatch.track(target.options.cwd);
		return opened;
	}
	const { session } = target;
	if (session.backend !== "claude-code") return notFound(session);
	const child = parseChildRef(session.sessionId);
	if (child) return parts.live.openChild(session, child, sink);
	if (!parts.live.isHosted(session.sessionId) && (await parts.terminal.writing(session.sessionId))) {
		const stored = await locateWritten(parts, session.sessionId);
		if (isRejected(stored)) return stored;
		return openPromotableWatch(
			{
				ref: session,
				watchPresence: (listener) => parts.terminal.watchPresence(session.sessionId, listener),
				finishExited: () => parts.terminal.finishExited(session.sessionId),
				isTerminalActive: () => parts.terminal.writing(session.sessionId),
				locate: () => parts.store.locate(session.sessionId),
				dormantSnapshot: (found) => dormantSnapshot(parts, found),
				openWatch: (found, watchSink) => parts.terminal.openWatchOnly(session, found, watchSink),
				openHosted: async (hostedSink) => {
					const opened = await parts.live.open(target, hostedSink);
					if (!isRejected(opened)) void trackStored(parts, session.sessionId);
					return opened;
				},
				now: () => parts.services.clock.now(),
			},
			stored,
			sink,
		);
	}
	const opened = await parts.live.open(target, sink);
	if (!isRejected(opened)) void trackStored(parts, session.sessionId);
	return opened;
}

export function notFound(ref: SessionRef): Rejected {
	return rejected("not_found", `no Claude Code session ${ref.backend}/${ref.sessionId}`);
}

async function locateWritten(parts: ClaudeCodeParts, sessionId: SessionId): Promise<StoredSession | Rejected> {
	const { clock } = parts.services;
	const deadline = clock.now() + FIRST_FLUSH_MS;
	for (;;) {
		const stored = await parts.store.locate(sessionId);
		if (!isRejected(stored) || stored.rejection.code !== "not_found" || clock.now() >= deadline) return stored;
		if (!(await parts.terminal.writing(sessionId))) return stored;
		await new Promise<void>((resolve) => clock.after(LOOK_AGAIN_MS, resolve));
	}
}

async function dormantSnapshot(parts: ClaudeCodeParts, stored: StoredSession) {
	const found = await parts.store.get(stored.sessionId, parts.overlay);
	const recorded = found.status === "accepted" ? found.summary.modelId : undefined;
	const [listed, mode] = await Promise.all([
		recorded !== undefined && stored.cwd !== undefined
			? parts.catalogue.listedModelId(stored.cwd, recorded)
			: Promise.resolve(undefined),
		defaultPermissionMode(parts.services.sdk, stored.cwd, parts.services.mayBypassPermissions),
	]);
	return dormantClaudeSnapshot(listed ?? recorded, mode);
}

async function trackStored(parts: ClaudeCodeParts, sessionId: SessionId): Promise<void> {
	const stored = await parts.store.locate(sessionId).catch(() => undefined);
	if (stored !== undefined && !isRejected(stored) && stored.cwd !== undefined) parts.configWatch.track(stored.cwd);
}
