/** Lane G · the `TerminalWatch` `backend.ts` builds (D21): sessions another process writes open watch-only. */

import type { OpenResult } from "../../../contract";
import type { TerminalDeps } from "../ports/deps";
import type { TerminalWatch } from "../ports/terminal";
import { notBuilt } from "../rejections";

export function createTerminalWatch(_deps: TerminalDeps): TerminalWatch {
	return {
		writing: async () => false,
		openWatchOnly: async (): Promise<OpenResult> => notBuilt("lane G: openWatchOnly"),
		start: async () => undefined,
		dispose: async () => undefined,
	};
}
