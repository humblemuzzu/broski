/**
 * The notices a session's last start reported, so the next start of the same session reports only what changed.
 * Pi's terminal prints them once per process; a hosted session starts again every time it is opened after its host
 * ended, and the same missing package or untrusted project would otherwise greet the phone at each open.
 */

import type { NoticeEvent } from "../../../contract";

const REMEMBERED_SESSIONS = 256;

export class NoticeMemory {
	private readonly shown = new Map<string, ReadonlySet<string>>();

	/** The notices of this start that the session's previous start did not report; this start's become the record. */
	fresh(sessionId: string, notices: readonly NoticeEvent[]): NoticeEvent[] {
		const before = this.shown.get(sessionId);
		const keys = notices.map((notice) => `${notice.level}\n${notice.text}`);
		this.shown.delete(sessionId);
		this.shown.set(sessionId, new Set(keys));
		while (this.shown.size > REMEMBERED_SESSIONS) {
			const oldest = this.shown.keys().next().value;
			if (oldest === undefined) break;
			this.shown.delete(oldest);
		}
		return notices.filter((_, at) => !before?.has(keys[at] ?? ""));
	}
}
