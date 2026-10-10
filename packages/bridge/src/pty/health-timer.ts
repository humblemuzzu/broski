import { type ManagedInterval, nodeInterval } from "../timers";

export type GatedIntervalOptions = {
	intervalMs: number;
	/** Return false to stop the interval until ensureRunning() is called again. */
	onTick: () => boolean;
	interval?: ManagedInterval;
};

/** A repeating timer that only exists while its callback still has work to do. */
export class GatedInterval {
	private readonly options: GatedIntervalOptions;
	private readonly interval: ManagedInterval;
	private stopCurrent: (() => void) | null = null;

	constructor(options: GatedIntervalOptions) {
		this.options = options;
		this.interval = options.interval ?? nodeInterval;
	}

	get running(): boolean {
		return this.stopCurrent !== null;
	}

	ensureRunning(): void {
		if (this.stopCurrent) return;
		this.stopCurrent = this.interval.start(() => this.runTick(), this.options.intervalMs);
	}

	runTick(): void {
		if (!this.options.onTick()) this.stop();
	}

	stop(): void {
		const stop = this.stopCurrent;
		this.stopCurrent = null;
		stop?.();
	}
}
