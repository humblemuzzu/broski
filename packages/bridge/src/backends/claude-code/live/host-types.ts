/** What a host is started with, what it asks of the registry, and the control its views share. */

import type { ActionResult, QueueItemId, SessionControl, SessionId, SessionSnapshot } from "../../../contract";
import type { SessionHost } from "./host";

export interface HostStart {
	readonly sessionId: SessionId;
	readonly cwd: string;
	/** True for a session that exists: `resume`; false: `sessionId` (D2). */
	readonly resume: boolean;
	/** The open snapshot: the model, the thinking and the modes the session starts in. */
	readonly snapshot: SessionSnapshot;
	/** The newest chain entry before this host; null for a session with none, undefined when it could not be read. */
	readonly tail: string | null | undefined;
	/** The model the person named, if they did. */
	readonly model?: string;
}

export interface HostHooks {
	/** The host is idle and detached past the grace: the registry ends it. */
	idle(host: SessionHost): void;
	/** The host ended: the registry forgets it. */
	forget(host: SessionHost): void;
	/** The conversation went on under a new session id (`/clear`). */
	renamed(host: SessionHost, previous: SessionId): void;
}

/** `SessionControl` with the methods a session this bridge hosts always has. */
export type HostControl = Omit<SessionControl, "compact" | "cancelQueued" | "cancelCompaction" | "cancelRetry"> & {
	compact(instructions: string | undefined): Promise<ActionResult>;
	cancelQueued(id: QueueItemId): Promise<ActionResult>;
	cancelCompaction(): Promise<ActionResult>;
};
