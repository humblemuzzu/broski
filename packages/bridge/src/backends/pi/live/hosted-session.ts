/** What the registry reads from an existing session's `SessionManager` before it hosts it. */

import { contentText } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { type PermissionsRecord, readPermissionsRecord } from "../broski-entries";
import { promptTitle } from "../mapping/prompt-title";
import type { SessionStore, StoredSession } from "../ports";
import { NO_LIVE } from "../store/list";
import type { HostedFacts } from "./host-summary";

export async function factsOf(
	stored: StoredSession,
	cwd: string,
	manager: SessionManager,
	store: SessionStore,
	now: () => number,
): Promise<HostedFacts> {
	const found = await store.get(stored.sessionId, NO_LIVE);
	const summary = found.status === "accepted" ? found.summary : undefined;
	const at = now();
	const name = manager.getSessionName();
	const firstText = firstPromptText(manager);
	const firstPrompt = firstText === undefined ? undefined : promptTitle(firstText);
	return {
		sessionId: stored.sessionId,
		cwd,
		origin: stored.origin,
		createdAt: summary?.createdAt ?? at,
		updatedAt: summary?.updatedAt ?? at,
		...(summary?.parent && { parent: summary.parent }),
		...(name !== undefined && { name }),
		...(firstPrompt !== undefined && { firstPrompt }),
		prompted: firstText !== undefined,
	};
}

/** The newest `broski.permissions` entry anywhere in the file: a guard that was on stays on across a branch change. */
export function lastPermissions(manager: SessionManager): PermissionsRecord {
	for (const entry of manager.getEntries().reverse()) {
		const record = readPermissionsRecord(entry);
		if (record !== undefined) return record;
	}
	return { mode: "off", allowedTools: [] };
}

/** The first user message with text, which titles the session as the store's rows do (`store/session-details.ts`). */
function firstPromptText(manager: SessionManager): string | undefined {
	for (const entry of manager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = contentText(entry.message.content);
		if (text !== "") return text;
	}
	return undefined;
}
