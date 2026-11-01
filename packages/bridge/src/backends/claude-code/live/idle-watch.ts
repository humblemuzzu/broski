/** The idle grace (D1): a host nobody views and nothing runs in ends once it has stayed so for `IDLE_GRACE_MS`. */

import type { Clock } from "../ports/time";
import { IDLE_GRACE_MS } from "./shutdown";

export class IdleWatch {
	private cancel: (() => void) | undefined;

	/** `ends` is asked when the grace passes, and the host is still unviewed and idle. */
	constructor(
		private readonly clock: Clock,
		private readonly stillIdle: () => boolean,
		private readonly ends: () => void,
	) {}

	/** `wanted`: the host is unviewed and idle now. The grace runs while it stays so. */
	review(wanted: boolean): void {
		if (!wanted) {
			this.stop();
			return;
		}
		this.cancel ??= this.clock.after(IDLE_GRACE_MS, () => {
			this.cancel = undefined;
			if (this.stillIdle()) this.ends();
		});
	}

	stop(): void {
		this.cancel?.();
		this.cancel = undefined;
	}
}
