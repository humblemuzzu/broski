/** The adapter's two answers to a request: accepted, or `Rejected` with a code and a bounded message. */

import { type ActionAccepted, MAX_TEXT_CHARS, type Rejected, type RejectionCode } from "../../contract";
import { clip } from "./bounds";

export const ACCEPTED: ActionAccepted = { status: "accepted" };

export function rejected(code: RejectionCode, message: string): Rejected {
	return { status: "rejected", rejection: { code, message: clip(message, MAX_TEXT_CHARS) } };
}

/** The answer every control method gives once its session is closed (contract README §5, rule 3). */
export const CLOSED: Rejected = rejected("closed", "the session is closed");

/** Narrows a result union to its rejection, for `if (isRejected(x)) return x`. */
export function isRejected<T extends object>(value: T | Rejected): value is Rejected {
	return "status" in value && value.status === "rejected";
}
