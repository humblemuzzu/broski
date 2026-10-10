import { normalizeString } from "../runtime/shared";
import { BoundedMap, registerSweepable } from "../state/bounded-map";
import type { ServerMessage } from "../types";
import type { BroskiBackend } from "../types/runtime";

const MAX_EVENTS_PER_STREAM = 500;
const MAX_EVENT_AGE_MS = 5 * 60 * 1000;
/** Streams kept for reconnect replay; the least recently used ones go first. */
const MAX_BUFFERED_STREAMS = 64;

type BufferedRuntimeEvent = {
	seq: number;
	message: ServerMessage;
	timestamp: number;
};

const runtimeEventBuffers = new BoundedMap<string, BufferedRuntimeEvent[]>({
	maxEntries: MAX_BUFFERED_STREAMS,
	touchOnGet: false,
});

registerSweepable({
	name: "runtime-replay-buffers",
	sweep: () => {
		let dropped = 0;
		const cutoff = Date.now() - MAX_EVENT_AGE_MS;
		for (const [key, buffer] of [...runtimeEventBuffers]) {
			const kept = buffer.filter((entry) => entry.timestamp >= cutoff);
			if (kept.length === 0) {
				runtimeEventBuffers.delete(key);
				dropped++;
				continue;
			}
			if (kept.length !== buffer.length) runtimeEventBuffers.set(key, kept);
		}
		return dropped;
	},
	size: () => runtimeEventBuffers.size,
	limit: () => MAX_BUFFERED_STREAMS,
});

function streamKey(backend: BroskiBackend, sessionId?: string, cwd?: string): string {
	const normalizedSessionId = normalizeString(sessionId);
	if (normalizedSessionId) return `${backend}::${normalizedSessionId}`;
	return `${backend}::cwd::${normalizeString(cwd) ?? "unknown"}`;
}

function trimBuffer(key: string): void {
	const existing = runtimeEventBuffers.get(key);
	if (!existing || existing.length === 0) return;
	const cutoff = Date.now() - MAX_EVENT_AGE_MS;
	const recent = existing.filter((entry) => entry.timestamp >= cutoff);
	if (recent.length > MAX_EVENTS_PER_STREAM) {
		recent.splice(0, recent.length - MAX_EVENTS_PER_STREAM);
	}
	if (recent.length === 0) {
		runtimeEventBuffers.delete(key);
		return;
	}
	runtimeEventBuffers.set(key, recent);
}

function cloneReplayedMessage(message: ServerMessage): ServerMessage {
	if (message.type !== "runtime_event") return message;
	return {
		...message,
		data: {
			...message.data,
			replayed: true,
		},
	};
}

export function recordRuntimeEvent(message: ServerMessage): void {
	if (message.type !== "runtime_event") return;
	const backend = message.backend;
	const sessionId = normalizeString(message.data.sessionId);
	const cwd = normalizeString(message.data.cwd);
	const seq = typeof message.data.seq === "number" ? message.data.seq : undefined;
	if (!backend || seq == null || seq <= 0) return;

	const key = streamKey(backend, sessionId, cwd);
	const existing = runtimeEventBuffers.get(key) ?? [];
	existing.push({
		seq,
		message,
		timestamp: Date.now(),
	});
	runtimeEventBuffers.set(key, existing);
	trimBuffer(key);
}

export function replayRuntimeEventsSince(params: {
	backend: BroskiBackend;
	sessionId?: string;
	cwd?: string;
	lastSeq?: number;
}): ServerMessage[] {
	const { backend, sessionId, cwd } = params;
	const lastSeq = typeof params.lastSeq === "number" ? params.lastSeq : 0;
	const key = streamKey(backend, sessionId, cwd);
	trimBuffer(key);
	const existing = runtimeEventBuffers.get(key) ?? [];
	if (existing.length === 0) return [];
	return existing.filter((entry) => entry.seq > lastSeq).map((entry) => cloneReplayedMessage(entry.message));
}
