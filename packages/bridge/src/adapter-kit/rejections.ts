import { clip, MAX_TEXT_CHARS, type Rejected, type RejectionCode } from "../contract";

/** `Rejected` with a code and a message bounded for the wire. */
export function rejected(code: RejectionCode, message: string): Rejected {
	return { status: "rejected", rejection: { code, message: clip(message, MAX_TEXT_CHARS) } };
}
