/** The prompts the phone sent through a terminal, until the terminal echoes them as user messages. */

import { type ClientRequestId, MAX_LIST_ITEMS } from "../../../contract";

interface Sent {
	readonly clientRequestId: ClientRequestId;
	readonly text: string;
	/** It was sent to an idle terminal, so it starts the run. */
	readonly startsRun: boolean;
}

export class SentPrompts {
	private sent: Sent[] = [];

	add(clientRequestId: ClientRequestId, text: string, startsRun: boolean): void {
		this.sent.push({ clientRequestId, text, startsRun });
		if (this.sent.length > MAX_LIST_ITEMS) this.sent.shift();
	}

	get startsRun(): boolean {
		return this.sent.some((prompt) => prompt.startsRun);
	}

	/** The id of the oldest prompt whose text a user message repeats; the prompt is no longer waited for. */
	claim(text: string): ClientRequestId | undefined {
		const index = this.sent.findIndex((prompt) => prompt.text === text);
		if (index < 0) return undefined;
		const [claimed] = this.sent.splice(index, 1);
		return claimed?.clientRequestId;
	}

	/** The terminal did not take the prompt. */
	forget(clientRequestId: ClientRequestId): void {
		this.sent = this.sent.filter((prompt) => prompt.clientRequestId !== clientRequestId);
	}

	/** The run ended: what was sent for it and never echoed was not taken. */
	clear(): void {
		this.sent = [];
	}
}
