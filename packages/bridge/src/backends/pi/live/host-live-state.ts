import type { AgentEvent, NativeIds, SessionSnapshot } from "../../../contract";
import { LiveState } from "./live-state";

/** The `LiveState` of a hosted session, which tells its host after each event: every part emits through it. */
export class HostLiveState extends LiveState {
	constructor(
		initial: SessionSnapshot,
		now: () => number,
		private readonly emitted: (event: AgentEvent) => void,
	) {
		super(initial, now);
	}

	override emit(event: AgentEvent, native?: NativeIds): void {
		super.emit(event, native);
		this.emitted(event);
	}
}
