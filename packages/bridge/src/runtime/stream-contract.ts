import type { BroskiBackend, BroskiRuntimeEvent } from "../types/runtime";

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

const streamStates = new Map<string, RuntimeStreamState>();

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

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
