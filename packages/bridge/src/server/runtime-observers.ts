import type { BroskiRuntimeEvent } from "../types/runtime";
import { tapRuntimeEvent } from "./link-feed/feed";

/**
 * Every complete runtime event the bridge maps passes here, once, at the envelope site: the daemon's
 * feed needs the whole stream rather than a socket's view.
 */
export function observeRuntimeEvent(event: BroskiRuntimeEvent): void {
	tapRuntimeEvent(event);
}
