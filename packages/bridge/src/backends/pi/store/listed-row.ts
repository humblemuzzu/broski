import type { SessionSummary } from "../../../contract";

/** A row of a listing before its summary is made: what the order and the cursor need, and how to make the rest. */
export interface ListedRow {
	readonly updatedAt: number;
	readonly sessionId: string;
	summary(): Promise<SessionSummary>;
}
