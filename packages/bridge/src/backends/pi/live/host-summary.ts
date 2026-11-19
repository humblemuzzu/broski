/** The list row of a session this bridge hosts, kept from what the host knows, for `session_updated`. */

import {
	MAX_NAME_CHARS,
	MAX_PATH_CHARS,
	type SessionOrigin,
	type SessionParent,
	type SessionSnapshot,
	type SessionSummary,
	sessionStatus,
	type Timestamp,
} from "../../../contract";
import { clipStart } from "../bounds";
import type { LiveRow, TranscriptCut } from "../ports";

/** What a host knows of its session without reading the file. */
export interface HostedFacts {
	readonly sessionId: string;
	readonly cwd: string;
	readonly createdAt: Timestamp;
	readonly updatedAt: Timestamp;
	readonly origin: SessionOrigin;
	readonly parent?: SessionParent;
	/** `session_info` name, set by a rename. */
	readonly name?: string;
	/** The title the first user message with text gives the session. */
	readonly firstPrompt?: string;
	/** A user message with text was sent, so a later one does not title the session. */
	readonly prompted: boolean;
}

export function hostedSummary(facts: HostedFacts, snapshot: SessionSnapshot): SessionSummary {
	const title = titleOf(facts);
	const runStartedAt = snapshot.run?.startedAt ?? snapshot.compaction?.startedAt;
	return {
		session: { backend: "pi", sessionId: facts.sessionId },
		...(title && { title }),
		...(facts.cwd.length > 0 && facts.cwd.length <= MAX_PATH_CHARS && { cwd: facts.cwd }),
		createdAt: facts.createdAt,
		updatedAt: facts.updatedAt,
		...(runStartedAt !== undefined && { runStartedAt }),
		...(facts.parent && { parent: facts.parent }),
		...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
		status: sessionStatus(snapshot),
		origin: facts.origin,
	};
}

function titleOf(facts: HostedFacts): SessionSummary["title"] {
	const name = facts.name?.trim();
	if (name) return { text: clipStart(name, MAX_NAME_CHARS), source: "user" };
	const prompt = facts.firstPrompt?.trim();
	return prompt ? { text: clipStart(prompt, MAX_NAME_CHARS), source: "first_prompt" } : undefined;
}

/** Nothing the snapshot holds keeps the session busy: no ask, queued input, compaction, retry or background task. */
export function quietSnapshot(snapshot: SessionSnapshot): boolean {
	return (
		snapshot.interactions.length === 0 &&
		snapshot.queue.length === 0 &&
		snapshot.compaction === undefined &&
		snapshot.retry === undefined &&
		snapshot.backgroundTasks.length === 0
	);
}

/** What the store lays over a hosted session's row: its status and model, and the cut while a run is active. */
export function liveRowOf(snapshot: SessionSnapshot, cut: TranscriptCut | undefined): LiveRow {
	const runStartedAt = snapshot.run?.startedAt ?? snapshot.compaction?.startedAt;
	return {
		status: sessionStatus(snapshot),
		...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
		...(runStartedAt !== undefined && { runStartedAt }),
		...(cut && { cut }),
	};
}
