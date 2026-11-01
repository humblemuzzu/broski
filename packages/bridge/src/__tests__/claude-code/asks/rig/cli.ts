/** The CLI side of the ask rig: something that raises the asks the desk answers, and ends its turn when they are over. */

import type { AskDesk } from "../../../../backends/claude-code/ports/asks";
import type { InteractionKind } from "../../../../contract";

export type TurnEnd = "completed" | "aborted";

export interface AskCli {
	/** Starts one turn that raises an ask of `kind` through `desk`; `done` settles when the turn is over. */
	start(kind: InteractionKind, desk: AskDesk): Promise<{ done: Promise<TurnEnd> }>;
	/** What Stop does to the CLI: it cancels what it waits on and ends the turn. */
	interrupt(): Promise<void>;
	close(): Promise<void>;
}

export type AskCliFactory = () => AskCli;
