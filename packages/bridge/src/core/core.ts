import type { AgentBackend, BackendFactory, BackendId, JsonValue } from "../contract";
import { BackendRegistry } from "./backend-registry";
import { CatalogFeed } from "./catalog-feed";
import { CoreClient } from "./client";
import type { CoreContext } from "./context";
import { DEFAULT_REPLAY_WINDOW, type ReplayWindow } from "./event-log";
import { InteractionDesk } from "./interaction-desk";
import { DEFAULT_IDLE_CLOSE_MS } from "./keep-open";
import type { ClientLink, CoreClock, CoreLog, DirectoryPolicy, PromptJournal, ReplacementJournal } from "./ports";
import { PromptLedger } from "./prompt-ledger";
import { ProtocolServer } from "./protocol-server";
import { Replacements } from "./replacements";
import { SessionHub } from "./session-hub";

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
	private readonly clients = new Set<CoreClient>();

	constructor(private readonly options: CoreOptions) {
		const desk = new InteractionDesk();
		const replacements = new Replacements(options.clock, options.replacementJournal);
		this.hub = new SessionHub({
			maxFrameBytes: options.maxFrameBytes,
			replay: options.replay ?? DEFAULT_REPLAY_WINDOW,
			clock: options.clock,
			log: options.log,
			idleCloseMs: options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS,
			onEvent: (live, event) => desk.observe(live, event),
			replacements,
		});
		this.feed = new CatalogFeed(this.clients, this.hub, options.maxFrameBytes, options.log);
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
			},
		};
	}

	/** Bridge shutdown: every backend is disposed, which closes their sessions; pending asks expire with them. */
	async dispose(): Promise<void> {
		this.hub.dispose();
		await this.registry.dispose();
	}

	/** A backend that landed is news to every client that listed the backends before it did. */
	private async announce(backend: AgentBackend): Promise<void> {
		const status = await this.registry.status(backend);
		this.feed.publish(backend.id, { type: "status_changed", status });
	}
}
