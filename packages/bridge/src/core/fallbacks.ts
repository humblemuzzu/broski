import {
	type ActionResult,
	type AgentBackend,
	type AgentEvent,
	type BackendDescriptor,
	type ForkPoint,
	type NewSessionResult,
	type PromptInput,
	type PromptMode,
	type PromptResult,
	type QueueItemId,
	type SessionCapabilities,
	type SessionControl,
	type SessionRef,
	sessionCapabilities,
} from "../contract";
import type { BackendRegistry } from "./backend-registry";
import { BridgeQueue, type PromptSend } from "./bridge-queue";
import type { LiveSession } from "./live-session";
import { PortableFork } from "./portable-fork";
import type { CoreClock, CoreLog, DirectoryPolicy } from "./ports";
import { unsupported } from "./results";
import type { SessionHub } from "./session-hub";
import { SteerFallback } from "./steer-fallback";

/** What the bridge does itself for a backend that cannot; each is off unless asked for. */
export interface FallbackOptions {
	/** A queue for a backend whose prompts take no `queue` mode. */
	readonly queue?: boolean;
	/** Stop-and-start steering for a backend whose prompts take no `steer` mode. */
	readonly steer?: boolean;
	/** A fork into a new session with a context handoff, for a backend with no `fork`. */
	readonly portableFork?: boolean;
}

export interface FallbackDeps {
	readonly registry: BackendRegistry;
	readonly hub: SessionHub;
	readonly directories: DirectoryPolicy;
	readonly clock: CoreClock;
	readonly log: CoreLog;
}

const PROMPT_MODES: readonly PromptMode[] = ["start", "steer", "queue"];

/**
 * The core's fallbacks for what a backend lacks: each is on only when asked for and the backend lacks the capability
 * natively, so a backend that queues, steers or forks itself never meets them. What one adds, the backend is
 * described with (`backends.list`, an attach's capabilities), so a phone offers exactly what the bridge serves.
 */
export class CoreFallbacks {
	private readonly queue: BridgeQueue;
	private readonly steering: SteerFallback;
	private readonly forks: PortableFork;

	constructor(
		private readonly options: FallbackOptions,
		private readonly deps: FallbackDeps,
	) {
		this.queue = new BridgeQueue(this.send, deps.log);
		this.steering = new SteerFallback(this.send, deps.clock);
		this.forks = new PortableFork(deps.hub, deps.directories, deps.clock);
	}

	/** `descriptor` as the bridge serves it, with what its fallbacks add. */
	described(descriptor: BackendDescriptor): BackendDescriptor {
		const capabilities = descriptor.capabilities;
		const modes = new Set(capabilities.promptModes);
		if (this.options.queue) modes.add("queue");
		if (this.options.steer) modes.add("steer");
		const queues = this.options.queue === true && !capabilities.promptModes.includes("queue");
		return {
			...descriptor,
			capabilities: {
				...capabilities,
				promptModes: PROMPT_MODES.filter((mode) => modes.has(mode)),
				queue: capabilities.queue || queues,
				fork: capabilities.fork || this.options.portableFork === true,
			},
		};
	}

	capabilitiesOf(live: LiveSession): SessionCapabilities {
		const own = sessionCapabilities(live.open);
		return { ...own, cancelQueued: own.cancelQueued || (own.controllable && this.queues(live)) };
	}

	prompt(live: LiveSession, control: SessionControl, input: PromptInput): Promise<PromptResult> {
		if (input.mode === "queue" && this.queues(live)) return this.queue.prompt(live, control, input);
		if (input.mode === "steer" && this.steers(live)) return this.steer(live, control, input);
		return this.send(live, control, input);
	}

	async cancelQueued(live: LiveSession, control: SessionControl, id: QueueItemId): Promise<ActionResult> {
		if (this.queues(live)) return this.queue.cancel(live, id);
		return control.cancelQueued ? control.cancelQueued(id) : unsupported("cancel queued input");
	}

	fork(backend: AgentBackend, ref: SessionRef, at: ForkPoint | undefined): Promise<NewSessionResult> {
		if (backend.fork) return backend.fork(ref, at);
		return this.options.portableFork
			? this.forks.fork(backend, ref, at)
			: Promise.resolve(unsupported("fork a session"));
	}

	/** Every event of every open session, after the observer had it. */
	observe(live: LiveSession, event: AgentEvent): void {
		if (event.type === "run_started") live.extras.starting = false;
		if (event.type !== "run_finished") return;
		for (const ended of [...live.extras.runEnds]) ended();
		if (this.queues(live)) this.queue.observe(live, event);
	}

	/** A steer that started no run leaves the stopped session idle: what the bridge queued starts instead. */
	private async steer(live: LiveSession, control: SessionControl, input: PromptInput): Promise<PromptResult> {
		try {
			return await this.steering.steer(live, control, input);
		} finally {
			if (this.queues(live)) this.queue.resume(live);
		}
	}

	/** Every prompt the bridge sends; a start counts as under way until its run begins or it is refused. */
	private readonly send: PromptSend = async (live, control, input) => {
		const sent = this.forks.withHandoff(live.ref, input);
		const starting = input.mode === "start";
		if (starting) live.extras.starting = true;
		let result: PromptResult | undefined;
		try {
			result = await control.prompt(sent);
		} finally {
			if (starting && (result?.status !== "accepted" || result.disposition !== "started")) {
				live.extras.starting = false;
			}
		}
		if (sent !== input && result.status === "accepted") this.forks.taken(live.ref);
		return result;
	};

	private queues(live: LiveSession): boolean {
		return this.options.queue === true && !this.modesOf(live).includes("queue");
	}

	private steers(live: LiveSession): boolean {
		return this.options.steer === true && !this.modesOf(live).includes("steer");
	}

	private modesOf(live: LiveSession): readonly PromptMode[] {
		return this.deps.registry.get(live.ref.backend)?.traits.promptModes ?? PROMPT_MODES;
	}
}
