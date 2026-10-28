import type { BroskiBackend, BroskiRuntimeEvent, BroskiRuntimeState, BroskiSessionSummary } from "./runtime";

export type RuntimeServerMessage =
	| {
			type: "runtime_event";
			backend: BroskiBackend;
			data: BroskiRuntimeEvent;
			/** The bridge shrank this event to fit the link; `data` carries the marker. */
			truncated?: boolean;
	  }
	| { type: "runtime_session_updated"; backend: BroskiBackend; session: BroskiSessionSummary }
	| { type: "runtime_session_removed"; backend: BroskiBackend; sessionId: string }
	| { type: "runtime_state"; backend: BroskiBackend; data: BroskiRuntimeState };
