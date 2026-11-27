import type { LiveState } from "../../../adapter-kit/live-state";
import type { AgentEvent, NativeIds, SessionSnapshot } from "../../../contract";
import type { SessionEmitter } from "../ports/live";

/** Every event passes here so the host can review whether it may end. */
export class HostEmitter implements SessionEmitter {
	constructor(
		private readonly state: LiveState,
		private readonly after: () => void,
	) {}

	snapshot(): SessionSnapshot {
		return this.state.snapshot();
	}

	emit(event: AgentEvent, native?: NativeIds): void {
		this.state.emit(event, native);
		this.after();
	}
}
