import type { SessionRef } from "../contract";
import { BoundedMap } from "../state/bounded-map";
import type { CoreClock, ReplacementJournal, ReplacementRecord } from "./ports";

/** Replacements remembered, across every session. */
export const REPLACEMENT_MEMORY = 4_096;

/** How long a replacement is remembered; a phone away longer finds the old session as it was left. */
export const REPLACEMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Which stream replaced which (contract README §5, `session_replaced`). A phone that was away when
 * its session was replaced resumes the stream that ended; this says where the conversation went on.
 *
 * Keyed by the retired stream's epoch, not by the session id: a phone that opens the old session on
 * purpose, to read its history, holds the epoch of a later stream and is not sent away. Each record
 * names the successor's epoch too, which is how a chain (A replaced by B replaced by C) is followed
 * from the phone's epoch alone. Bounded in number and in age, and kept by the journal across restarts.
 */
export class Replacements {
	private readonly byEpoch = new BoundedMap<string, ReplacementRecord>({
		maxEntries: REPLACEMENT_MEMORY,
		touchOnGet: false,
	});

	constructor(
		private readonly clock: CoreClock,
		private readonly journal: ReplacementJournal | undefined,
	) {
		for (const record of journal?.load() ?? []) this.byEpoch.set(record.epoch, record);
	}

	/** The stream `epoch` ended in `session_replaced`; the conversation went on as `next`, whose stream has epoch `nextEpoch`. */
	record(epoch: string, next: SessionRef, nextEpoch: string): void {
		const record: ReplacementRecord = { epoch, next, nextEpoch, at: this.clock.now() };
		this.byEpoch.set(epoch, record);
		this.journal?.append(record);
	}

	/**
	 * Where the conversation of the stream `epoch` went on, after every later replacement; undefined
	 * when that stream was not replaced or its record is gone.
	 */
	successor(epoch: string): SessionRef | undefined {
		const now = this.clock.now();
		let record = this.live(epoch, now);
		if (!record) return undefined;
		const visited = new Set([epoch]);
		while (!visited.has(record.nextEpoch)) {
			visited.add(record.nextEpoch);
			const next = this.live(record.nextEpoch, now);
			if (!next) break;
			record = next;
		}
		return record.next;
	}

	private live(epoch: string, now: number): ReplacementRecord | undefined {
		const record = this.byEpoch.get(epoch);
		return record && !expired(record, now) ? record : undefined;
	}
}

function expired(record: ReplacementRecord, now: number): boolean {
	return now - record.at > REPLACEMENT_TTL_MS;
}
