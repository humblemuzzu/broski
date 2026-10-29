import type { PromptAccepted, PromptInput, PromptResult, SessionRef } from "../contract";
import { BoundedMap } from "../state/bounded-map";
import type { PromptJournal } from "./ports";
import { sessionScopedKey } from "./session-key";

/** Accepted prompts remembered, across every session. */
export const PROMPT_MEMORY = 10_000;

/**
 * Prompt idempotency across what an adapter cannot see (contract README §10): a session closed and
 * opened again, and a bridge restart, through the journal. A repeat of an accepted `clientRequestId`
 * gets the first result and reaches no backend. A rejection is not remembered, so the same id may be
 * sent again once its cause is gone. A repeat that arrives while the first is still on its way waits
 * for it and gets the same result.
 */
export class PromptLedger {
	private readonly accepted = new BoundedMap<string, PromptAccepted>({ maxEntries: PROMPT_MEMORY });
	private readonly inFlight = new Map<string, Promise<PromptResult>>();

	constructor(private readonly journal: PromptJournal | undefined) {
		for (const entry of journal?.load() ?? []) {
			this.accepted.set(sessionScopedKey(entry.session, entry.clientRequestId), entry.result);
		}
	}

	submit(
		session: SessionRef,
		input: PromptInput,
		send: (input: PromptInput) => Promise<PromptResult>,
	): Promise<PromptResult> {
		const key = sessionScopedKey(session, input.clientRequestId);
		const known = this.accepted.get(key);
		if (known) return Promise.resolve(known);
		const pending = this.inFlight.get(key);
		if (pending) return pending;
		const sending = send(input)
			.then((result) => {
				if (result.status === "accepted") this.remember(session, input, result);
				return result;
			})
			.finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, sending);
		return sending;
	}

	private remember(session: SessionRef, input: PromptInput, result: PromptAccepted): void {
		this.accepted.set(sessionScopedKey(session, input.clientRequestId), result);
		this.journal?.append({ session, clientRequestId: input.clientRequestId, result });
	}
}
