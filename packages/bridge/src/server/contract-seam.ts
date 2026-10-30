import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import type { ActionResult, BackendFactory, BackendId, InteractionAnswer, JsonValue, SessionRef } from "../contract";
import { BridgeCore, type CoreConnection } from "../core/core";
import { CONTRACT_FRAME_TYPE } from "../core/frame";
import type { CoreClock } from "../core/ports";
import { getSecurePath } from "../security";
import type { RuntimeSendQueue } from "../utils/runtime-send-queue";
import { openPromptJournal } from "./contract-prompt-journal";
import { openReplacementJournal } from "./contract-replacement-journal";
import type { BridgeLimits } from "./limits";
import { contractFeedObserver } from "./link-feed/feed";
import type { LeveledLogger } from "./logger";

/** Where the journals live when backends are served and no other directory is given. */
function defaultJournalDirectory(): string {
	return join(homedir(), ".broski", "core");
}

/** How the bridge core is set up. Production passes none and serves no backend until Phase 4 brings the adapters. */
export type ContractOptions = {
	readonly backends?: ReadonlyArray<readonly [BackendId, BackendFactory]>;
	/**
	 * Where the core keeps what must outlive a bridge restart: `prompts.jsonl` (prompt idempotency)
	 * and `replacements.jsonl` (replaced sessions). `~/.broski/core` once there are backends.
	 */
	readonly journalDirectory?: string;
	readonly idleCloseMs?: number;
	readonly clock?: CoreClock;
};

/** The contract protocol on the bridge's sockets, beside the old protocol until Phase 4 deletes it. */
export type ContractSeam = {
	/** True for a `{"type":"contract",…}` frame, which belongs to the core rather than the old routes. */
	owns(frame: JsonValue): boolean;
	/** A frame `owns` claimed, `bytes` long in UTF-8. */
	receive(ws: ServerWebSocket<unknown>, frame: JsonValue, bytes: number): Promise<void>;
	/**
	 * A frame the connection layer's rate limit refused. A contract frame is answered `rate_limited`
	 * here and this returns true; for any other frame it returns false and the old protocol answers.
	 */
	refuse(ws: ServerWebSocket<unknown>, raw: string | Uint8Array): boolean;
	disconnect(ws: ServerWebSocket<unknown>): void;
	/**
	 * A person's answer that does not come from a phone attached to the session: the daemon's feed
	 * relays a decision made on a lock screen. Checked and applied as a phone's answer is.
	 */
	answer(session: SessionRef, answer: InteractionAnswer): Promise<ActionResult>;
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
	queue: Pick<RuntimeSendQueue, "sendPayload">,
	limits: Pick<BridgeLimits, "linkMessageLimitBytes">,
	logger: Pick<LeveledLogger, "logInfo" | "logError">,
): ContractSeam {
	const backends = options?.backends ?? [];
	const ids = backends.map(([id]) => id);
	if (new Set(ids).size !== ids.length) throw new Error(`a backend is configured twice: ${ids.join(", ")}`);
	const log = { info: logger.logInfo, error: logger.logError };
	const journals = options?.journalDirectory ?? (backends.length > 0 ? defaultJournalDirectory() : undefined);
	const core = new BridgeCore({
		bridgeVersion: version,
		maxFrameBytes: limits.linkMessageLimitBytes,
		log,
		clock: options?.clock ?? SYSTEM_CLOCK,
		observer: contractFeedObserver,
		directories: async (path) => (await getSecurePath(path)) ?? undefined,
		...(journals !== undefined && {
			journal: openPromptJournal(join(journals, "prompts.jsonl"), log),
			replacementJournal: openReplacementJournal(join(journals, "replacements.jsonl"), log),
		}),
		...(options?.idleCloseMs !== undefined && { idleCloseMs: options.idleCloseMs }),
	});

	const connections = new WeakMap<ServerWebSocket<unknown>, CoreConnection>();
	const connectionOf = (ws: ServerWebSocket<unknown>): CoreConnection => {
		const known = connections.get(ws);
		if (known) return known;
		// The send queue holds what a congested socket cannot take and closes one that falls a window behind.
		const connection = core.connect({ send: (frame) => queue.sendPayload(ws, frame) });
		connections.set(ws, connection);
		return connection;
	};
	const owns = (frame: JsonValue): boolean =>
		frame !== null && typeof frame === "object" && !Array.isArray(frame) && frame.type === CONTRACT_FRAME_TYPE;
	return {
		owns,
		receive: (ws, frame, bytes) =>
			connectionOf(ws)
				.receive(frame, bytes)
				.catch((error) => logger.logError(`[core] a frame failed in the core: ${String(error)}`)),
		refuse: (ws, raw) => {
			const frame = parsedFrame(raw);
			if (frame === undefined || !owns(frame)) return false;
			connectionOf(ws).refuse(frame);
			return true;
		},
		disconnect: (ws) => {
			connections.get(ws)?.close();
			connections.delete(ws);
		},
		answer: (session, answer) => core.answer(session, answer),
		start: () => {
			for (const [id, factory] of backends) void core.addBackend(id, factory);
		},
		stop: () => core.dispose(),
	};
}

function parsedFrame(raw: string | Uint8Array): JsonValue | undefined {
	try {
		return JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
	} catch {
		return undefined;
	}
}
