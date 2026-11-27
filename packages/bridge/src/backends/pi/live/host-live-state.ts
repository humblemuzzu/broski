import { LiveState } from "../../../adapter-kit/live-state";
import type { AgentEvent, NativeIds, SessionSnapshot } from "../../../contract";

/** The `LiveState` of a hosted session, which tells its host after each event: every part emits through it. */
export class HostLiveState extends LiveState {
	constructor(
		initial: SessionSnapshot,
		now: () => number,
		private readonly emitted: (event: AgentEvent) => void,
	) {
		super(initial, now);
	}

	override emit(event: AgentEvent, native?: NativeIds, at?: number): void {
		super.emit(event, native, at);
		this.emitted(event);
	}
}
