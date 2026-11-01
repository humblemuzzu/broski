import type { Clock } from "../../../../backends/claude-code/ports";

interface Timer {
	readonly at: number;
	readonly run: () => void;
}

/** A clock the test moves: `after` timers fire when `advance` reaches them. */
export class ManualClock implements Clock {
	private time = 1_000_000;
	private readonly timers = new Set<Timer>();

	now(): number {
		return this.time;
	}

	after(ms: number, run: () => void): () => void {
		const timer: Timer = { at: this.time + ms, run };
		this.timers.add(timer);
		return () => {
			this.timers.delete(timer);
		};
	}

	get pending(): number {
		return this.timers.size;
	}

	advance(ms: number): void {
		this.time += ms;
		for (const timer of [...this.timers]) {
			if (timer.at <= this.time && this.timers.delete(timer)) timer.run();
		}
	}
}
