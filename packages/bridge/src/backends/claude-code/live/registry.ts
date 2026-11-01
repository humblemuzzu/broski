/** Lane D · the `LiveSessions` `backend.ts` builds: one host per hosted session (D1), opened, reached and ended here. */

import type { OpenResult, Rejected } from "../../../contract";
import type { LiveDeps } from "../ports/deps";
import type { HostView, LiveSessions } from "../ports/live";
import { notBuilt } from "../rejections";

export function createLiveSessions(_deps: LiveDeps): LiveSessions {
	const no = (what: string) => notBuilt(`lane D: live ${what}`);
	return {
		row: () => undefined,
		open: async (): Promise<OpenResult> => no("open"),
		openChild: async (): Promise<OpenResult> => no("openChild"),
		isHosted: () => false,
		withLiveHost: async <T>(
			_sessionId: string,
			_work: (host: HostView | undefined) => Promise<T>,
		): Promise<T | Rejected> => no("withLiveHost"),
		withHost: async <T>(_sessionId: string, _work: (host: HostView) => Promise<T>): Promise<T | Rejected> =>
			no("withHost"),
		end: async () => undefined,
		dispose: async () => undefined,
	};
}
