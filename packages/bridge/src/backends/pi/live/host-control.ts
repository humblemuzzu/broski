/**
 * The control every view of a hosted session shares; it takes the session lock for what D2 lists. What reaches Pi
 * waits for the extensions to start, as a terminal takes no input before then: until they have, it is `busy`.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ActionResult, Rejected, SessionControl } from "../../../contract";
import { CLOSED } from "../rejections";
import type { InteractionDesk } from "../ui/interactions";
import { requestCompaction } from "./compaction-request";
import type { SessionSettings } from "./settings";

/** `SessionControl` with the methods a session this bridge made always has. */
export type HostControl = Omit<SessionControl, "compact"> & {
	compact(instructions: string | undefined): Promise<ActionResult>;
};

type Guarded = <T>(work: () => Promise<T>) => Promise<T | Rejected>;

export interface HostControlDeps {
	readonly session: () => AgentSession;
	readonly ended: () => boolean;
	/** Under the session lock. */
	readonly locked: Guarded;
	/** Under the session lock, once the extensions have started. */
	readonly whenBound: Guarded;
	/** Not under the lock: an abort must reach Pi while a prompt waits on it (D2). */
	readonly abort: () => Promise<ActionResult>;
	readonly prompt: SessionControl["prompt"];
	readonly interactions: InteractionDesk;
	readonly settings: SessionSettings;
	readonly running: () => boolean;
	readonly nextCompactionStart: () => Promise<void>;
}

export function hostControl(deps: HostControlDeps): HostControl {
	const { settings, whenBound, ended } = deps;
	return {
		prompt: (input) => whenBound(() => deps.prompt(input)),
		abort: deps.abort,
		answer: async (answer) => (ended() ? CLOSED : deps.interactions.answer(answer)),
		setModel: (modelId) => whenBound(() => settings.setModel(modelId)),
		setThinking: (value) => whenBound(async () => settings.setThinking(value)),
		setMode: (axis, value) => deps.locked(async () => settings.setMode(axis, value)),
		compact: (instructions) =>
			whenBound(() =>
				requestCompaction(deps.session(), instructions, {
					running: deps.running(),
					started: deps.nextCompactionStart,
				}),
			),
	};
}
