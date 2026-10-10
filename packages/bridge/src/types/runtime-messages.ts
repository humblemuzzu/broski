import type {
	BroskiBackend,
	BroskiModelSummary,
	BroskiRuntimeEvent,
	BroskiRuntimeState,
	BroskiSessionSummary,
} from "./runtime";

export type RuntimeServerMessage =
	| { type: "runtime_event"; backend: BroskiBackend; data: BroskiRuntimeEvent }
	| { type: "runtime_models"; backend: BroskiBackend; data: BroskiModelSummary[] }
	| { type: "runtime_sessions"; backend: BroskiBackend; data: BroskiSessionSummary[] }
	| { type: "runtime_state"; backend: BroskiBackend; data: BroskiRuntimeState };
