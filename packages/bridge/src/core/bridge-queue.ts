import type {
	ActionResult,
	AgentEvent,
	PromptInput,
	PromptResult,
	QueueItem,
	QueueItemId,
	SessionControl,
} from "../contract";
import { settled } from "./deadline";
import type { LiveSession } from "./live-session";
import type { CoreLog } from "./ports";
import { rejected } from "./results";

/** Prompts the bridge holds for one session at once. */
export const MAX_BRIDGE_QUEUE = 32;

/** How a prompt reaches the adapter: its control's `prompt`, with what the bridge adds to it. */
export type PromptSend = (live: LiveSession, control: SessionControl, input: PromptInput) => Promise<PromptResult>;

/**
 * A queue for a backend that has none of its own: a `queue` prompt that arrives while a run is active is held by the
 * bridge, shown as the session's queue, and started once the run ends. Aborting the run hands what is queued back to
 * the composer (`input_returned`). The queue keeps the session open as any queued input does (`holdsOpen`).
 */
export class BridgeQueue {
	constructor(
		private readonly send: PromptSend,
		private readonly log: CoreLog,
	) {}

	async prompt(live: LiveSession, control: SessionControl, input: PromptInput): Promise<PromptResult> {
		if (live.extras.queued.length === 0 && idle(live)) return this.send(live, control, { ...input, mode: "start" });
		const { extras } = live;
		if (extras.queued.length >= MAX_BRIDGE_QUEUE) {
			return rejected("busy", `the bridge holds at most ${MAX_BRIDGE_QUEUE} queued prompts`);
		}
		const item: QueueItem = {
			id: crypto.randomUUID(),
			delivery: "queue",
			preview: input.text,
			clientRequestId: input.clientRequestId,
		};
		extras.queued = [...extras.queued, { item, input }];
		publishQueue(live);
		return { status: "accepted", disposition: "queued", queueItemId: item.id };
	}

	cancel(live: LiveSession, id: QueueItemId): ActionResult {
		const kept = live.extras.queued.filter(({ item }) => item.id !== id);
		if (kept.length === live.extras.queued.length) return rejected("not_found", `no queued input ${id}`);
		live.extras.queued = kept;
		publishQueue(live);
		return { status: "accepted" };
	}

	/** Everything queued goes back to the composer. */
	returnAll(live: LiveSession): void {
		const queued = live.extras.queued;
		if (queued.length === 0) return;
		live.extras.queued = [];
		publishQueue(live);
		const texts = queued.map(({ input }) => input.text).filter((text) => text.length > 0);
		if (texts.length > 0) live.inject({ type: "input_returned", texts });
	}

	/** Starts the head of the queue when nothing else will: no run, and no start or restart under way. */
	resume(live: LiveSession): void {
		if (live.extras.queued.length > 0 && idle(live)) void this.dispatch(live);
	}

	/** A run that ends hands the queue on: aborted, it gives the queue back; otherwise the head starts. */
	observe(live: LiveSession, event: AgentEvent): void {
		if (event.type !== "run_finished" || live.extras.queued.length === 0 || live.extras.restarting) return;
		if (event.outcome.kind === "aborted") this.returnAll(live);
		else void this.dispatch(live);
	}

	private async dispatch(live: LiveSession): Promise<void> {
		const { extras } = live;
		const control = live.open.control;
		const [head, ...rest] = extras.queued;
		if (!control || !head) return;
		extras.queued = rest;
		extras.dispatching = true;
		publishQueue(live);
		// The adapter is still inside the emit of its `run_finished`; its run is over once that returns.
		await Promise.resolve();
		const sent = await settled(() => this.send(live, control, { ...head.input, mode: "start" }));
		extras.dispatching = false;
		if (sent.ok && sent.value.status === "accepted") return;
		const why = sent.ok ? JSON.stringify(sent.value) : sent.thrown;
		this.log.error(`[core] ${live.label}: a queued prompt could not start: ${why}`);
		extras.queued = [head, ...extras.queued];
		this.returnAll(live);
	}
}

function idle(live: LiveSession): boolean {
	const { extras } = live;
	return !live.snapshot.run && !extras.dispatching && !extras.starting && !extras.restarting;
}

/** The whole queue: the adapter's own, then the bridge's. */
function publishQueue(live: LiveSession): void {
	const items = [...live.extras.adapterQueue, ...live.extras.queued.map(({ item }) => item)];
	live.inject({ type: "queue_changed", items });
}
