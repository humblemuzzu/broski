/** The two events a hosted session emits about itself rather than about a run: a notice and a fault. */

import { errorText } from "../../../adapter-kit/error-text";
import type { ChildExit } from "../../../adapter-kit/stdio-child";
import type { ErrorEvent, NoticeEvent, NoticeLevel } from "../../../contract";
import { phoneText } from "../phone-text";

/** How a `pi` that exited unasked is told: how it ended, and what it said on stderr. */
export function exitMessage(exit: ChildExit, stderr: string): string {
	const how = exit.error ?? (exit.signal ? `was stopped by ${exit.signal}` : `exited with code ${exit.code}`);
	return `Pi ${how}${stderr === "" ? "" : `: ${stderr}`}`;
}

export function noticeEvent(level: NoticeLevel, text: string): NoticeEvent {
	return { type: "notice", level, text: phoneText(text) };
}

/** Something the adapter could not do outside a run's outcome; never retryable, the cause is not Pi's. */
export function faultEvent(error: unknown): ErrorEvent {
	return { type: "error", error: { code: "unknown", message: phoneText(errorText(error)) }, retryable: false };
}
