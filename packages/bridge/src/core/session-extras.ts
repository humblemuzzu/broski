import type { Interaction, InteractionId, InteractionReply, PromptInput, QueueItem, SessionRef } from "../contract";
import type { LiveSession } from "./live-session";

export type ExternalInteractionOutcome =
	| { readonly kind: "answered"; readonly reply: InteractionReply }
	| { readonly kind: "ended"; readonly reason: "withdrawn" | "expired" };

/** An ask the bridge raised itself (`BridgeCore.raiseExternalInteraction`), which no adapter knows of. */
export interface BridgeAsk {
	readonly interaction: Interaction;
	/** The session the asker held, released once the ask ends. */
	readonly held: SessionRef;
	readonly settle: (outcome: ExternalInteractionOutcome) => void;
}

/** A prompt the bridge queued for a backend that has no queue of its own (`bridge-queue.ts`). */
export interface QueuedPrompt {
	readonly item: QueueItem;
	readonly input: PromptInput;
}

/**
 * What the bridge keeps on an open session beside the adapter's own state. A stream that replaces the session takes
 * it over, as it takes over the claims of answers on their way.
 */
export class SessionExtras {
	readonly asks = new Map<InteractionId, BridgeAsk>();
	queued: QueuedPrompt[] = [];
	/** The queue the adapter itself reports, such as its pending steers, which the bridge's goes after. */
	adapterQueue: QueueItem[] = [];
	/** The head of the queue is on its way to the adapter: a prompt arriving now waits behind it. */
	dispatching = false;
	/** A start is on its way to the adapter and its run has not begun yet: a queued prompt waits behind it. */
	starting = false;
	/** A steer is stopping the run to start another: the run's end returns no queued input. */
	restarting = false;
	/** Told when the session's run ends. */
	readonly runEnds = new Set<() => void>();
	/** The stream these belong to now; set by each `LiveSession` that takes them. */
	stream: LiveSession | undefined;
}
