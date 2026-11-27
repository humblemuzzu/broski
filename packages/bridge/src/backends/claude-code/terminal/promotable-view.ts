/**
 * A watch-only Claude Code view that promotes to controllable dormant-hosted mode as soon as the tracked terminal
 * `claude` process exits, and switches back if a terminal opens the session again before the phone acts
 * (`adapter-kit/promotable-view.ts`). Claude Code hosts a session only where its working directory still is.
 */

import { statSync } from "node:fs";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { openPromotableView, type PromotableViewDeps } from "../../../adapter-kit/promotable-view";
import { emptySnapshot, type OpenResult, type SessionSink, type SessionSnapshot } from "../../../contract";
import { DEFAULT_PERMISSION_MODE, PERMISSIONS_AXIS } from "../permission-modes";
import type { StoredSession } from "../ports/store";

export type PromotableWatchDeps = Omit<PromotableViewDeps<StoredSession>, "promotable" | "hostedMethods">;

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export function openPromotableWatch(
	deps: PromotableWatchDeps,
	stored: StoredSession,
	sink: SessionSink,
	start: "watching" | "dormant" = "watching",
): Promise<OpenResult> {
	const promotable = (found: StoredSession) => found.cwd !== undefined && isDirectory(found.cwd);
	return openPromotableView(
		{ ...deps, promotable, hostedMethods: { compact: true, cancelQueued: true } },
		stored,
		sink,
		start,
	);
}

export function dormantClaudeSnapshot(
	modelId: string | undefined,
	mode: PermissionMode = DEFAULT_PERMISSION_MODE,
): SessionSnapshot {
	return {
		...emptySnapshot(),
		modes: [{ axis: PERMISSIONS_AXIS, value: mode }],
		...(modelId !== undefined && { modelId }),
	};
}
