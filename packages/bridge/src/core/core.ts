import type {
	ActionResult,
	AgentBackend,
	BackendFactory,
	BackendId,
	InteractionAnswer,
	JsonValue,
	SessionRef,
} from "../contract";
import { BackendRegistry } from "./backend-registry";
import { answerFromBridge } from "./bridge-answer";
import { CatalogFeed } from "./catalog-feed";
import { CoreClient } from "./client";
import type { CoreContext } from "./context";
import { DEFAULT_REPLAY_WINDOW, type ReplayWindow } from "./event-log";
import { InteractionDesk } from "./interaction-desk";
import { DEFAULT_IDLE_CLOSE_MS } from "./keep-open";
import { type CoreObserver, Observation } from "./observer";
import type {
	ClientLink,
	CoreClock,
	CoreLog,
	DirectoryPolicy,
	PromptJournal,
	ReplacementJournal,
	WorkspaceFactory,
	WorkspaceHost,
} from "./ports";
import { PromptLedger } from "./prompt-ledger";
import { ProtocolServer } from "./protocol-server";
import { Replacements } from "./replacements";
import { rejected } from "./results";
import { SessionHub } from "./session-hub";
import { TerminalViewers } from "./terminal-viewers";

export interface CoreOptions {
	readonly bridgeVersion: string;
	/** The largest frame a client is sent; the link's per-message cap. */
	readonly maxFrameBytes: number;
	readonly log: CoreLog;
	readonly clock: CoreClock;
	readonly directories: DirectoryPolicy;
	/** Remembers accepted prompts across bridge restarts; without one they are remembered in memory only. */
	readonly journal?: PromptJournal;
	/** Remembers replaced sessions across bridge restarts; without one they are remembered in memory only. */
	readonly replacementJournal?: ReplacementJournal;
	readonly idleCloseMs?: number;
	readonly replay?: ReplayWindow;
	/** Told of every event of every open session, viewed or not. */
	readonly observer?: CoreObserver;
	/** The machine's files, git and terminals; without it every workspace request is `unsupported`. */
	readonly workspace?: WorkspaceFactory;
}

/** One client's view of the core, for the connection that carries it. */
export interface CoreConnection {
	/** One `{"type":"contract","message":…}` frame from the client, `bytes` long in UTF-8. */
	receive(frame: JsonValue, bytes: number): Promise<void>;
	/** A frame the connection's rate limit refused: it is answered `rate_limited` and not served. */
	refuse(frame: JsonValue): void;
	/** The connection closed: the client views nothing any more. */
	close(): void;
}

/**
 * The bridge core: it speaks the contract protocol to clients and the `AgentBackend` interface to
 * adapters, and owns what no backend provides (docs/architecture/core/README.md).
 */
export class BridgeCore {
	private readonly registry: BackendRegistry;
	private readonly hub: SessionHub;
	private readonly feed: CatalogFeed;
	private readonly server: ProtocolServer;
	private readonly desk = new InteractionDesk();
	private readonly clients = new Set<CoreClient>();
	private readonly terminals: TerminalViewers;
	private readonly workspace: WorkspaceHost | undefined;

	constructor(private readonly options: CoreOptions) {
		const { desk } = this;
		const observation = new Observation(
			options.observer,
			(ref) => this.registry.get(ref.backend),
			options.clock,
			options.log,
		);
		const replacements = new Replacements(options.clock, options.replacementJournal);
		this.hub = new SessionHub({
			maxFrameBytes: options.maxFrameBytes,
			replay: options.replay ?? DEFAULT_REPLAY_WINDOW,
			clock: options.clock,
			log: options.log,
			idleCloseMs: options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS,
			onEvent: (live, record, before) => {
				desk.observe(live, record.event);
				observation.publish(live, record, before);
			},
			replacements,
		});
		this.feed = new CatalogFeed(this.clients, this.hub, options.maxFrameBytes, options.log);
		this.terminals = new TerminalViewers(options.maxFrameBytes, options.log);
		this.workspace = options.workspace?.(this.terminals.publish);
		this.registry = new BackendRegistry({
			onCatalog: (backend, event) => this.feed.publish(backend, event),
			onArrival: (backend) => void this.announce(backend),
			clock: options.clock,
			log: options.log,
		});
		const ctx: CoreContext = {
			registry: this.registry,
			hub: this.hub,
			desk,
			ledger: new PromptLedger(options.journal),
			replacements,
			directories: options.directories,
			workspace: this.workspace,
			terminals: this.terminals,
			bridgeVersion: options.bridgeVersion,
			maxFrameBytes: options.maxFrameBytes,
			clock: options.clock,
			log: options.log,
		};
		this.server = new ProtocolServer(ctx);
	}

	/**
	 * Starts and registers a backend; resolves false when it failed to start (logged). Requests that
	 * name it meanwhile wait for it. Production adds none before Phase 4.
	 */
	addBackend(id: BackendId, factory: BackendFactory): Promise<boolean> {
		return this.registry.add(id, factory);
	}

	connect(link: ClientLink): CoreConnection {
		const client = new CoreClient(link, this.options.log);
		this.clients.add(client);
		return {
			receive: (frame, bytes) => this.server.receive(client, frame, bytes),
			refuse: (frame) => this.server.refuse(client, frame),
			close: () => {
				this.clients.delete(client);
				for (const live of client.disconnect()) this.hub.leave(live, client);
				this.terminals.leave(client);
			},
		};
	}

	/**
	 * A person's answer from outside the phones attached to the session (the daemon's feed). It meets
	 * the same checks as a phone's and, as there, answers nothing by itself.
	 */
	answer(ref: SessionRef, answer: InteractionAnswer): Promise<ActionResult> {
		return answerFromBridge(
			{ hub: this.hub, desk: this.desk, clock: this.options.clock, log: this.options.log },
			ref,
			answer,
		);
	}

	/**
	 * Pins the session open with no client attached, opening it as an attach would: its events reach the observer, and
	 * what it raises keeps it open and can be answered (core README §20). Never answers anything itself.
	 */
	async hold(ref: SessionRef): Promise<ActionResult> {
		const reached = await this.registry.reach(ref.backend);
		return "backend" in reached ? this.hub.hold(reached.backend, ref) : rejected("not_found", reached.missing);
	}

	/** Lets one `hold` of the session go. */
	release(ref: SessionRef): void {
		this.hub.release(ref);
	}

	/**
	 * Bridge shutdown: every backend is disposed, which closes their sessions; pending asks expire with them.
	 * Every terminal ends.
	 */
	async dispose(): Promise<void> {
		this.hub.dispose();
		await Promise.all([this.registry.dispose(), this.disposeWorkspace()]);
	}

	private async disposeWorkspace(): Promise<void> {
		try {
			await this.workspace?.dispose();
		} catch (error) {
			this.options.log.error(`[core] the workspace failed to dispose: ${String(error)}`);
		}
	}

	/** A backend that landed is news to every client that listed the backends before it did. */
	private async announce(backend: AgentBackend): Promise<void> {
		const status = await this.registry.status(backend);
		this.feed.publish(backend.id, { type: "status_changed", status });
	}
}
