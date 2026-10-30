import type { FileChange } from "../content";
import type { BackendExtension } from "../extensions";
import type { InteractionRequest } from "../interactions";
import type { JsonValue } from "../json";
import type { NoticeLevel } from "../notice";
import type { Plan } from "../plan";
import type { ErrorInfo, RunLimit } from "../runs";
import type { Usage } from "../usage";

export interface FakeToolStep {
	kind: "tool";
	name: string;
	input: JsonValue;
	output: string;
	/** Stream the arguments first: `tool_started` without input, then a `ToolInputSet` update. */
	streamInput?: boolean;
	/** Ask for permission before running; a denial finishes the tool as `denied`. */
	permission?: boolean;
	fails?: boolean;
	fileChanges?: FileChange[];
	nested?: FakeToolStep[];
	/** The tool runs a subagent in a child session. */
	child?: boolean;
}

/** Steps that produce content or wait on someone. */
type FakeContentStep =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "plan_proposal"; text: string }
	/** One text block naming the model this request runs with, as `modelSwitch` decides it. */
	| { kind: "echo_model" }
	/** Later blocks belong to a new assistant message. */
	| { kind: "new_message" }
	/** Retracts the current assistant message and starts a new one. */
	| { kind: "retract" }
	| FakeToolStep
	| { kind: "ask"; title: string; request: InteractionRequest; blocksRun?: boolean }
	/** Waits until the run is aborted or the test releases it. */
	| { kind: "hold" };

/** Steps that report a state change or end the run. */
export type FakeSignalStep =
	| { kind: "compaction" }
	| { kind: "retry"; attempts: number }
	/** The backend hands queued input back, as an abort that clears its queue does. */
	| { kind: "return_input"; texts: string[] }
	| { kind: "usage"; usage: Usage }
	| { kind: "plan"; plan: Plan }
	| { kind: "notice"; level: NoticeLevel; text: string }
	| { kind: "extension"; extension: BackendExtension }
	| { kind: "backend_error"; error: ErrorInfo; retryable: boolean }
	/** The backend starts a new conversation in the live session, under a new id. */
	| { kind: "replace_session" }
	| { kind: "fail"; error: ErrorInfo }
	| { kind: "limit"; limit: RunLimit }
	| { kind: "suspend" }
	| { kind: "defer" };

/** One thing a fake run does. A run plays its steps in order, then finishes `completed` unless a step ends it. */
export type FakeStep = FakeContentStep | FakeSignalStep;

export const DEFAULT_REPLY: FakeStep[] = [{ kind: "text", text: "Done." }];
