import { BoundedMap, registerSweepable } from "../state/bounded-map";
import type { BroskiBackend, BroskiRuntimeEvent } from "../types/runtime";
import { normalizeString } from "./shared";

type RuntimeStreamHints = {
	backend?: BroskiBackend;
	sessionId?: string;
	cwd?: string;
	turnId?: string;
	startStream?: boolean;
	finishStream?: boolean;
	isReplay?: boolean;
};

type RuntimeStreamState = {
	nextSeq: number;
	streamCounter: number;
	currentStreamId?: string;
	currentTurnId?: string;
};

/** Six hours idle is far past any reconnect that still asks for a replay. */
export const RUNTIME_STREAM_STATE_TTL_MS = 6 * 60 * 60 * 1000;
export const RUNTIME_STREAM_STATE_MAX_KEYS = 4000;

const streamStates = new BoundedMap<string, RuntimeStreamState>({
	maxEntries: RUNTIME_STREAM_STATE_MAX_KEYS,
	ttlMs: RUNTIME_STREAM_STATE_TTL_MS,
	touchOnGet: false,
});

registerSweepable({
	name: "runtime-stream-states",
	sweep: (now) => streamStates.sweep(now),
	size: () => streamStates.size,
	limit: () => RUNTIME_STREAM_STATE_MAX_KEYS,
});

function keyFor(backend: BroskiBackend, sessionId?: string, cwd?: string): string {
	return `${backend}::${normalizeString(sessionId) ?? `cwd:${normalizeString(cwd) ?? "unknown"}`}`;
}

function getState(key: string): RuntimeStreamState {
	const existing = streamStates.get(key);
	if (existing) return existing;
	const created: RuntimeStreamState = {
		nextSeq: 0,
		streamCounter: 0,
	};
	streamStates.set(key, created);
	return created;
}

function nextStreamId(key: string, state: RuntimeStreamState): string {
	state.streamCounter += 1;
	return `${key}:${Date.now()}:${state.streamCounter}`;
}

function extractTurnId(event: BroskiRuntimeEvent, hints?: RuntimeStreamHints): string | undefined {
	const fromHints = normalizeString(hints?.turnId);
	if (fromHints) return fromHints;

	const backendData = event.backendData;
	if (!backendData || typeof backendData !== "object") return undefined;

	return (
		normalizeString((backendData as Record<string, unknown>).turnId) ??
		normalizeString((backendData as Record<string, unknown>).turnID) ??
		normalizeString((backendData as Record<string, unknown>).turn_id)
	);
}

export function enrichRuntimeEvent<T extends BroskiRuntimeEvent>(event: T, hints?: RuntimeStreamHints): T {
	const backend = hints?.backend ?? event.backend;
	const sessionId = hints?.sessionId ?? event.sessionId;
	const cwd = hints?.cwd ?? event.cwd;
	const key = keyFor(backend, sessionId, cwd);
	const state = getState(key);
	const turnId = extractTurnId(event, hints);
	const isStart = hints?.startStream ?? event.type === "agent_started";
	const isFinish = hints?.finishStream ?? (event.type === "agent_finished" || event.type === "error");

	if (turnId) {
		state.currentTurnId = turnId;
	}

	let streamId = normalizeString((event as Record<string, unknown>).streamId);
	if (!streamId) {
		if (isStart || !state.currentStreamId) {
			streamId = nextStreamId(key, state);
			state.currentStreamId = streamId;
		} else {
			streamId = state.currentStreamId;
		}
	}

	state.nextSeq += 1;
	const seq = state.nextSeq;
	const effectiveTurnId = turnId ?? state.currentTurnId;

	const enriched = {
		...event,
		seq,
		...(streamId ? { streamId } : {}),
		...(effectiveTurnId ? { turnId: effectiveTurnId } : {}),
		...(hints?.isReplay ? { replayed: true } : {}),
	} as T;

	if (isFinish) {
		state.currentStreamId = undefined;
		state.currentTurnId = undefined;
	}

	return enriched;
}

export function resetRuntimeStreamState(backend: BroskiBackend, sessionId?: string, cwd?: string): void {
	streamStates.delete(keyFor(backend, sessionId, cwd));
}
