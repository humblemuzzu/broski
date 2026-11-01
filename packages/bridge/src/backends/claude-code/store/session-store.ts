/** Lane A · the `SessionStore` (`ports/store.ts`) `backend.ts` builds; every read goes through the SDK (D15). */

import type { ActionResult, NewSessionResult, Rejected } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import type { EntryRef, SessionStore, StoredSession } from "../ports/store";
import { notBuilt } from "../rejections";

export function createSessionStore(_deps: StoreDeps): SessionStore {
	const no = (what: string) => notBuilt(`lane A: store ${what}`);
	return {
		list: async () => no("list"),
		get: async () => no("get"),
		transcript: async () => no("transcript"),
		attachment: async () => no("attachment"),
		locate: async (): Promise<StoredSession | Rejected> => no("locate"),
		lastChainUuid: async (): Promise<string | null | Rejected> => no("lastChainUuid"),
		entryOf: async (): Promise<EntryRef | Rejected> => no("entryOf"),
		rename: async (): Promise<ActionResult> => no("rename"),
		fork: async (): Promise<NewSessionResult> => no("fork"),
		remove: async (): Promise<ActionResult> => no("remove"),
		announce: async () => undefined,
		invalidate: () => undefined,
		dispose: () => undefined,
	};
}
