import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import type { ActionResult, BackendFactory, BackendId, InteractionAnswer, JsonValue, SessionRef } from "../contract";
import { BridgeCore, type CoreConnection, type CoreOptions } from "../core/core";
import type { CoreClock } from "../core/ports";
import { allowedBasePaths, resolveSecurePath } from "../security";
import { frameBytes } from "../transport/send-limits";
import type { SendQueue } from "../transport/send-queue";
import type { SampledUsage } from "../usage/usage-reader";
import { workspaceFactory } from "../workspace/workspace-host";
import { openPromptJournal } from "./contract-prompt-journal";
import { openReplacementJournal } from "./contract-replacement-journal";
import type { BridgeLimits } from "./limits";
import { contractFeedObserver } from "./link-feed/feed";
import type { LeveledLogger } from "./logger";

/** Where the journals live when backends are served and no other directory is given. */
function defaultJournalDirectory(): string {
	return join(homedir(), ".broski", "core");
}

/** How the bridge core is set up: the backends it serves, and what tests change. */
export type ContractOptions = {
	readonly backends?: ReadonlyArray<readonly [BackendId, BackendFactory]>;
	/**
	 * Where the core keeps what must outlive a bridge restart: `prompts.jsonl` (prompt idempotency)
	 * and `replacements.jsonl` (replaced sessions). `~/.broski/core` once there are backends.
	 */
	readonly journalDirectory?: string;
	readonly idleCloseMs?: number;
	readonly clock?: CoreClock;
	/** The plans' usage, read on request and every so often from `start` to `stop`; without it `plan.usage` is unsupported. */
	readonly usage?: (log: (message: string) => void) => SampledUsage;
};

/** The contract protocol on the bridge's client sockets: every frame a client sends goes to the core. */
export type ContractSeam = {
	/**
	 * One frame from a client socket. The core serves a `{"type":"contract","message":…}` frame and answers
	 * anything else, unparsable text included, `invalid_message`.
	 */
	receive(ws: ServerWebSocket<unknown>, raw: string | Uint8Array): Promise<void>;
	/** A frame the connection layer's rate limit refused: answered `rate_limited` and not served. */
	refuse(ws: ServerWebSocket<unknown>, raw: string | Uint8Array): void;
	disconnect(ws: ServerWebSocket<unknown>): void;
	/**
	 * A person's answer that does not come from a phone attached to the session: the daemon's feed
	 * relays a decision made on a lock screen. Checked and applied as a phone's answer is.
	 */
	answer(session: SessionRef, answer: InteractionAnswer): Promise<ActionResult>;
	/** Pins a session open with no phone attached, so what it raises reaches the feed (core README §20). */
	hold(session: SessionRef): Promise<ActionResult>;
	/** Lets one `hold` of the session go. */
	release(session: SessionRef): void;
	/** Starts the backends, once the listeners are up: a slow start keeps no phone from connecting. */
	start(): void;
	stop(): Promise<void>;
};

const SYSTEM_CLOCK: CoreClock = {
	now: () => Date.now(),
	after: (ms, run) => {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
};

export function createContractSeam(
	options: ContractOptions | undefined,
	version: string,
	queue: Pick<SendQueue, "sendPayload">,
	limits: Pick<BridgeLimits, "linkMessageLimitBytes">,
	logger: Pick<LeveledLogger, "logInfo" | "logError">,
): ContractSeam {
	const backends = options?.backends ?? [];
	const ids = backends.map(([id]) => id);
	if (new Set(ids).size !== ids.length) throw new Error(`a backend is configured twice: ${ids.join(", ")}`);
	const usage = options?.usage?.(logger.logError);
	const core = new BridgeCore({
		...coreOptions(options, backends.length > 0, version, limits, logger),
		...(usage && { usage }),
	});
	const sockets = socketConnections(core, queue);
	let stopSampling: (() => void) | undefined;
	return {
		receive: (ws, raw) =>
			sockets
				.of(ws)
				.receive(parsedFrame(raw), frameBytes(raw))
				.catch((error) => logger.logError(`[core] a frame failed in the core: ${String(error)}`)),
		refuse: (ws, raw) => sockets.of(ws).refuse(parsedFrame(raw)),
		disconnect: (ws) => sockets.drop(ws),
		answer: (session, answer) => core.answer(session, answer),
		hold: (session) => core.hold(session),
		release: (session) => core.release(session),
		start: () => {
			for (const [id, factory] of backends) void core.addBackend(id, factory);
			stopSampling ??= usage?.sample();
		},
		stop: () => {
			stopSampling?.();
			return core.dispose();
		},
	};
}

function coreOptions(
	options: ContractOptions | undefined,
	servesBackends: boolean,
	version: string,
	limits: Pick<BridgeLimits, "linkMessageLimitBytes">,
	logger: Pick<LeveledLogger, "logInfo" | "logError">,
): CoreOptions {
	const log = { info: logger.logInfo, error: logger.logError };
	const journals = options?.journalDirectory ?? (servesBackends ? defaultJournalDirectory() : undefined);
	return {
		bridgeVersion: version,
		maxFrameBytes: limits.linkMessageLimitBytes,
		log,
		clock: options?.clock ?? SYSTEM_CLOCK,
		observer: contractFeedObserver,
		directories: resolveSecurePath,
		workspace: workspaceFactory({ policy: resolveSecurePath, bases: allowedBasePaths() }),
		...(journals !== undefined && {
			journal: openPromptJournal(join(journals, "prompts.jsonl"), log),
			replacementJournal: openReplacementJournal(join(journals, "replacements.jsonl"), log),
		}),
		...(options?.idleCloseMs !== undefined && { idleCloseMs: options.idleCloseMs }),
	};
}

/** The core's connection of each client socket, made with the socket's first frame. */
function socketConnections(core: BridgeCore, queue: Pick<SendQueue, "sendPayload">) {
	const connections = new WeakMap<ServerWebSocket<unknown>, CoreConnection>();
	return {
		of(ws: ServerWebSocket<unknown>): CoreConnection {
			const known = connections.get(ws);
			if (known) return known;
			// The send queue holds what a congested socket cannot take and closes one that falls a window behind.
			const connection = core.connect({ send: (frame) => queue.sendPayload(ws, frame) });
			connections.set(ws, connection);
			return connection;
		},
		drop(ws: ServerWebSocket<unknown>): void {
			connections.get(ws)?.close();
			connections.delete(ws);
		},
	};
}

/** The frame as JSON; text that does not parse is `null`, which the core refuses as no contract frame. */
function parsedFrame(raw: string | Uint8Array): JsonValue {
	try {
		return JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
	} catch {
		return null;
	}
}
