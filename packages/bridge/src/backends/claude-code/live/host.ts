/** Lane D · one hosted session: one `query()`, its inbox, its consumer, its desk and mapper, its live state (D1). */

import type { SessionId } from "../../../contract";
import type { LiveDeps } from "../ports/deps";

export interface HostStart {
	readonly sessionId: SessionId;
	readonly cwd: string;
	/** True for a session that exists: `resume`; false: `sessionId` (D2). */
	readonly resume: boolean;
}

export class SessionHost {
	constructor(
		readonly deps: LiveDeps,
		readonly start: HostStart,
	) {}
}
