import type { EntryCursor } from "./entry-cursor";

/** A holder's replay (`holder/replay-log.ts`) as a host follows it: whether it is under way, and when it ended. */
export class ReplayGate {
	active = false;
	private readonly ended = Promise.withResolvers<true>();

	constructor(private readonly cursor: EntryCursor) {}

	changed(replaying: boolean): void {
		this.active = replaying;
		if (replaying) return;
		this.cursor.endSeed();
		this.ended.resolve(true);
	}

	/** True once the replay has ended; false when `gone` settles first. */
	done(gone: Promise<unknown>): Promise<boolean> {
		return Promise.race([this.ended.promise, gone.then(() => false)]);
	}
}
