/** Whether this bridge's own `pi` runs a session, as told to a terminal that has it open: each change, once. */
export class BusyReport {
	private readonly told = new Set<string>();

	constructor(
		private readonly busy: (sessionId: string) => boolean,
		private readonly tell: ((sessionId: string, busy: boolean) => void) | undefined,
	) {}

	review(sessionId: string): void {
		const busy = this.busy(sessionId);
		if (busy === this.told.has(sessionId)) return;
		if (busy) this.told.add(sessionId);
		else this.told.delete(sessionId);
		this.tell?.(sessionId, busy);
	}
}
