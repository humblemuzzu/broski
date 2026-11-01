/** Lane A · the owner journal (D17, D37): which sessions and prompts this bridge made, at `<stateDir>/owned.jsonl`. */

import type { SessionId, SessionOrigin } from "../../contract";
import type { OwnershipDeps } from "./ports/deps";
import type { Ownership, PromptRecord } from "./ports/store";

export function createOwnership(deps: OwnershipDeps): Ownership {
	return new OwnerJournal(deps);
}

class OwnerJournal implements Ownership {
	constructor(readonly deps: OwnershipDeps) {}

	async load(): Promise<void> {}

	origin(_sessionId: SessionId): SessionOrigin {
		return "external";
	}

	async claim(_sessionId: SessionId): Promise<void> {}

	async notePrompt(_sessionId: SessionId, _sendUuid: string, _record: PromptRecord): Promise<void> {}

	prompt(_sessionId: SessionId, _sendUuid: string): PromptRecord | undefined {
		return undefined;
	}
}
