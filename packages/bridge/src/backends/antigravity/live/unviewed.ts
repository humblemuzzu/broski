/**
 * When a host no view has stops being hosted. agy's presence lock is held for as long as a session is hosted, and a
 * terminal `agy -r` that meets it warns "Conversation already open … Use /fork", so a host is closed once it has had
 * no view for `UNVIEWED_GRACE_MS` and is idle: `session/close` ends its worker and its lock goes. A view that comes
 * back within the grace finds the host as it was, with no `session/load`. A host with work in flight when the grace
 * ends is looked at again a grace later. These timers only close hosts.
 */

import type { Clock } from "../../../adapter-kit/clock";
import type { AgyHost } from "./host";

/**
 * On top of the core's minute (a session nobody views stays open that long before its view closes, the core's
 * `DEFAULT_IDLE_CLOSE_MS`): a phone back just after that still finds its chat hosted, and a terminal can take the chat
 * 75 s after the phone left it.
 */
export const UNVIEWED_GRACE_MS = 15_000;

export class UnviewedHosts {
	private readonly timers = new Map<AgyHost, () => void>();

	constructor(
		private readonly clock: Clock,
		private readonly close: (host: AgyHost) => void,
	) {}

	/** `host` joined the hosts, or a view attached to it or let it go. */
	review(host: AgyHost): void {
		if (host.viewed || host.ended) this.forget(host);
		else if (!this.timers.has(host)) this.wait(host);
	}

	forget(host: AgyHost): void {
		this.timers.get(host)?.();
		this.timers.delete(host);
	}

	private wait(host: AgyHost): void {
		const cancel = this.clock.after(UNVIEWED_GRACE_MS, () => {
			this.timers.delete(host);
			if (host.viewed || host.ended) return;
			if (host.idle()) this.close(host);
			else this.wait(host);
		});
		this.timers.set(host, cancel);
	}
}
