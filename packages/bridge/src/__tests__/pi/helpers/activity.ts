/** Counts the work the driver can see in flight, so `quiesce()` waits on that instead of on a timer. */
export class Activity {
	private inFlight = 0;
	private readonly idleWaiters: (() => void)[] = [];

	get busy(): boolean {
		return this.inFlight > 0;
	}

	/** Marks one piece of work started; call the returned function when it ends. */
	begin(): () => void {
		this.inFlight++;
		let ended = false;
		return () => {
			if (ended) return;
			ended = true;
			this.inFlight--;
			if (this.inFlight > 0) return;
			for (const resolve of this.idleWaiters.splice(0)) resolve();
		};
	}

	idle(): Promise<void> {
		if (!this.busy) return Promise.resolve();
		return new Promise((resolve) => this.idleWaiters.push(resolve));
	}

	/**
	 * Resolves once nothing is in flight and a whole macrotask has passed with nothing starting: what a
	 * run chains through microtasks has then all run.
	 */
	async settle(): Promise<void> {
		do {
			await this.idle();
			await new Promise<void>((resolve) => setImmediate(resolve));
		} while (this.busy);
	}
}
