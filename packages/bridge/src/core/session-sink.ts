import type { SessionSink, SinkRecord } from "../contract";
import type { LiveSession } from "./live-session";
import type { CoreLog } from "./ports";

/**
 * The sink an adapter gets for one open session. It never throws into the adapter (a throwing
 * listener breaks Pi's agent loop, pi §1). It holds what arrives before the hub has the session:
 * `open` resolves with the snapshot, and records emitted after that moment can run before the hub's
 * continuation does. It follows the live session across a `session_replaced`.
 */
export class SessionSinkRouter implements SessionSink {
	private target: LiveSession | undefined;
	private held: SinkRecord[] = [];

	constructor(
		private readonly log: CoreLog,
		private readonly label: string,
	) {}

	emit(record: SinkRecord): void {
		try {
			if (this.target) this.target.receive(record);
			else this.held.push(record);
		} catch (error) {
			this.log.error(`[core] ${this.label}: an event failed in the core: ${String(error)}`);
		}
	}

	/** From now on records go to `target`, the held ones first. */
	deliverTo(target: LiveSession): void {
		this.target = target;
		const held = this.held;
		this.held = [];
		for (const record of held) this.emit(record);
	}
}
