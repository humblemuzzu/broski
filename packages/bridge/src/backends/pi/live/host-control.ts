/**
 * The control every view of a hosted session shares; it takes the session lock for everything but `abort` and `answer`.
 * What reaches Pi waits until Pi has started the session's extensions (it reads no command before), and is `busy`
 * until then.
 */

import type { ActionResult, Rejected, SessionControl } from "../../../contract";
import type { InteractionDesk } from "../ui/interactions";
import type { SessionSettings } from "./settings";

/** `SessionControl` with the methods a session this bridge made always has. */
export type HostControl = Omit<SessionControl, "compact"> & {
	compact(instructions: string | undefined): Promise<ActionResult>;
};

type Guarded = <T>(work: () => Promise<T>) => Promise<T | Rejected>;

export interface HostControlDeps {
	/** Why the host takes nothing any more (closed, or reconnecting to its `pi`); undefined while it runs. */
	readonly stopped: () => Rejected | undefined;
	/** Under the session lock, once Pi has started the session. */
	readonly whenBound: Guarded;
	/** Not under the lock: an abort must reach Pi while a prompt waits on it. */
	readonly abort: () => Promise<ActionResult>;
	readonly prompt: SessionControl["prompt"];
	readonly compact: (instructions: string | undefined) => Promise<ActionResult>;
	readonly interactions: InteractionDesk;
	readonly settings: SessionSettings;
}

export function hostControl(deps: HostControlDeps): HostControl {
	const { settings, whenBound, stopped } = deps;
	return {
		prompt: (input) => whenBound(() => deps.prompt(input)),
		abort: deps.abort,
		answer: async (answer) => stopped() ?? deps.interactions.answer(answer),
		setModel: (modelId) => whenBound(() => settings.setModel(modelId)),
		setThinking: (value) => whenBound(() => settings.setThinking(value)),
		setMode: (axis, value) => whenBound(() => settings.setMode(axis, value)),
		compact: (instructions) => whenBound(() => deps.compact(instructions)),
	};
}
