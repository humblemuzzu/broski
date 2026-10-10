import * as pi from "../connectors/pi";
import { getTailscaleIPViaCli, interfaceFingerprint, readLocalEndpoints } from "../network";
import { EndpointWatcher } from "../network/endpoint-watcher";
import { sweepBoundedState } from "../state/bounded-map";
import type { ServerMessage } from "../types";
import type { LeveledLogger } from "./logger";
import type { BridgeState, BufferedStreamEvent } from "./state";
import type { Streams } from "./streams";

const HEARTBEAT_INTERVAL_MS = 20000;
const HEARTBEAT_DEAD_AFTER_MS = 90000;
/** Clients expect a tick every 30s; twice that without one means the connection is dead. */
const TICK_INTERVAL_MS = 30000;
const EVENT_BUFFER_STALE_MS = 120_000;
const EVENT_BUFFER_PRUNE_INTERVAL_MS = 300_000;
const CHAT_DEDUP_TTL_MS = 5 * 60 * 1000;

export type BridgeIntervals = {
	endpointWatcher: EndpointWatcher;
};

/** Periodic work: heartbeat, client tick, buffer/state pruning, and network-endpoint discovery. */
export function startBridgeIntervals(deps: {
	state: BridgeState;
	streams: Streams;
	log: LeveledLogger;
	getSecurePort: () => number;
}): BridgeIntervals {
	const { state } = deps;

	state.heartbeatTimer = setInterval(() => {
		const now = Date.now();
		for (const ws of state.sockets) {
			const ctx = state.contexts.get(ws);
			if (!ctx) continue;

			if (now - ctx.lastPongAt > HEARTBEAT_DEAD_AFTER_MS) {
				try {
					ws.close(4000, "Heartbeat timeout");
				} catch {
					// ignore
				}
				continue;
			}

			// Only keep one in-flight ping per client to make RTT meaningful.
			// But expire stale pings — if the pong was lost (e.g. during a
			// Tailscale DERP-to-direct path migration), we must not block
			// all future pings forever.  30s is generous (normal RTT < 500ms).
			if (ctx.pendingPing) {
				if (now - ctx.pendingPing.sentAt > 30_000) {
					ctx.pendingPing = undefined;
				} else {
					continue;
				}
			}

			const ping = {
				id: `ping_${now}_${Math.floor(Math.random() * 1_000_000)}`,
				sentAt: now,
			};
			ctx.pendingPing = ping;
			deps.streams.send(ws, { type: "ping", data: ping });
		}
	}, HEARTBEAT_INTERVAL_MS);

	// Prune stale event buffers every 5 minutes.  Replay only uses events
	// from the last 60s, so buffers for sessions that haven't streamed in
	// 2 minutes are dead weight.  Also prevents unbounded growth over very
	// long bridge uptimes (months without restart).
	const pruneEventBuffers = (buffers: Map<string, BufferedStreamEvent[]>): void => {
		const now = Date.now();
		for (const [key, buf] of buffers) {
			const newest = buf.length > 0 ? buf[buf.length - 1]!.ts : 0;
			if (now - newest > EVENT_BUFFER_STALE_MS) {
				buffers.delete(key);
			}
		}
	};
	state.eventBufferPruneTimer = setInterval(() => {
		pruneEventBuffers(state.ccEventBuffers);
		pruneEventBuffers(state.cxEventBuffers);
		pi.pruneIdleInstances();
		sweepBoundedState();
	}, EVENT_BUFFER_PRUNE_INTERVAL_MS);

	state.tickTimer = setInterval(() => {
		const now = Date.now();
		const tickPayload = JSON.stringify({
			type: "tick",
			timestamp: now,
			interval: TICK_INTERVAL_MS,
		});
		for (const ws of state.sockets) {
			state.runtimeSendQueue.sendRaw(ws, tickPayload);
		}

		// Evict stale chat dedup entries (older than 5 minutes)
		for (const [key, tsMs] of state.recentChatMessageIds) {
			if (now - tsMs > CHAT_DEDUP_TTL_MS) state.recentChatMessageIds.delete(key);
		}
	}, TICK_INTERVAL_MS);

	// ── Network endpoint watcher ─────────────────────────────────────────
	// Every 10s, re-discover IPs from the interface list (no subprocesses) and
	// broadcast changes to connected phones. The Tailscale CLI is consulted only
	// when the interfaces expose no CGNAT address and they just changed.
	const endpointWatcher = new EndpointWatcher({
		readEndpoints: readLocalEndpoints,
		interfacesFingerprint: interfaceFingerprint,
		resolveTailscaleViaCli: getTailscaleIPViaCli,
		onChange: (snapshot) => {
			deps.log.logInfo(
				`[Network] Endpoints changed — local=${snapshot.localIP}, tailscale=${snapshot.tailscaleIP}, hotspot=${snapshot.hotspotIP}`,
			);

			deps.streams.broadcast({
				type: "network_endpoints_updated",
				data: {
					localIP: snapshot.localIP,
					tailscaleIP: snapshot.tailscaleIP,
					hotspotIP: snapshot.hotspotIP,
					port: deps.getSecurePort(),
				},
			} as ServerMessage);
		},
	});
	endpointWatcher.start();

	return { endpointWatcher };
}
