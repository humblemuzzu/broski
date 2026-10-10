/**
 * Transcript parity helper: digests both readers' output instead of holding two copies of it, so a
 * 400 MB session can be compared without the comparison itself doubling the memory cost.
 */

import { createHash } from "node:crypto";
import { readPiSessionTranscript } from "../../src/connectors/pi/pi-session-transcript";
import { legacyReadPiSessionMessages } from "./pi-session-oracle";

export type PiTranscriptParity = {
	same: boolean;
	legacyMessages: number;
	boundedMessages: number;
	legacyDigest: string;
	boundedDigest: string;
};

export function digestMessages(messages: readonly unknown[]): string {
	const hash = createHash("sha256");
	for (const message of messages) {
		hash.update(JSON.stringify(message) ?? "undefined");
		hash.update("\n");
	}
	return hash.digest("hex");
}

export function firstDifference(left: readonly unknown[], right: readonly unknown[]): string | null {
	const shared = Math.min(left.length, right.length);
	for (let i = 0; i < shared; i++) {
		if (JSON.stringify(left[i]) !== JSON.stringify(right[i])) return `message ${i} differs`;
	}
	return left.length === right.length ? null : `length ${left.length} vs ${right.length}`;
}

export async function comparePiSessionTranscript(sessionPath: string, limit?: number): Promise<PiTranscriptParity> {
	const expected = await legacyReadPiSessionMessages(sessionPath, limit);
	const legacyDigest = digestMessages(expected);
	const legacyMessages = expected.length;
	expected.length = 0;
	Bun.gc(true);

	const actual = await readPiSessionTranscript(sessionPath, limit);
	const boundedDigest = digestMessages(actual);
	const boundedMessages = actual.length;

	return {
		same: legacyDigest === boundedDigest && legacyMessages === boundedMessages,
		legacyMessages,
		boundedMessages,
		legacyDigest,
		boundedDigest,
	};
}
