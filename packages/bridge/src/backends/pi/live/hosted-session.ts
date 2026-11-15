/** What a host knows of an existing session before it starts: the store's row of it. */

import type { SessionOrigin } from "../../../contract";
import type { StoredFacts } from "../ports";
import type { HostedFacts } from "./host-summary";

export function factsOf(
	stored: { readonly sessionId: string; readonly origin: SessionOrigin },
	cwd: string,
	facts: StoredFacts,
	now: number,
): HostedFacts {
	const { summary } = facts;
	const title = summary?.title;
	return {
		sessionId: stored.sessionId,
		cwd,
		origin: stored.origin,
		createdAt: summary?.createdAt ?? now,
		updatedAt: summary?.updatedAt ?? now,
		...(summary?.parent && { parent: summary.parent }),
		...(title?.source === "user" && { name: title.text }),
		...(title?.source === "first_prompt" && { firstPrompt: title.text }),
		prompted: title?.source === "first_prompt",
	};
}
