import type { BroskiRuntimeEvent } from "../types/runtime";
import { tapRuntimeEvent } from "./link-feed/feed";
import { pendingPermissions } from "./pending-permissions";

/**
 * Every complete runtime event the bridge maps passes here, once, at the envelope site.
 *
 * Two things need the whole stream rather than a socket's view: the daemon's feed, which tells the
 * machine what its agents are doing, and the pending-request registry, which is what a reconnecting
 * phone is handed back.
 */
export function observeRuntimeEvent(event: BroskiRuntimeEvent): void {
	tapRuntimeEvent(event);
	pendingPermissions.remember(event);
}
