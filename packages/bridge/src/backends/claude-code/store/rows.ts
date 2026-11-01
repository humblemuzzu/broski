/** Lane A · one `SessionSummary` from an `SDKSessionInfo` (D16). */

import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { SessionOrigin, SessionParent, SessionSummary } from "../../../contract";
import type { LiveRow } from "../ports/store";

export interface RowContext {
	readonly origin: SessionOrigin;
	readonly live?: LiveRow;
	readonly parent?: SessionParent;
}

/** Undefined for a row the contract cannot carry (an id that is not a UUID). */
export function sessionRow(_info: SDKSessionInfo, _context: RowContext): SessionSummary | undefined {
	return undefined;
}
