export type PtyBufferState = {
	buffer: string;
	timer: ReturnType<typeof setTimeout> | null;
	flushDelayMs: number;
	lastQueuedAt: number;
	truncated: boolean;
};

const PTY_FLUSH_NORMAL_MS = 16;
const PTY_FLUSH_FAST_MS = 8;
const PTY_FAST_BURST_BYTES = 96 * 1024;
const PTY_SOFT_FLUSH_BYTES = 256 * 1024;
const PTY_HARD_BUFFER_BYTES = 512 * 1024;
const PTY_TRIMMED_BUFFER_BYTES = 384 * 1024;
const PTY_TRUNCATED_NOTICE = "\r\n[broski] terminal output truncated to keep stream responsive\r\n";

export function createPtyBufferState(): PtyBufferState {
	return {
		buffer: "",
		timer: null,
		flushDelayMs: PTY_FLUSH_NORMAL_MS,
		lastQueuedAt: 0,
		truncated: false,
	};
}

export function pushPtyOutput(
	state: PtyBufferState,
	data: string,
	now: number,
): { shouldFlushNow: boolean; didTruncate: boolean; flushDelayMs: number } {
	const deltaMs = state.lastQueuedAt ? now - state.lastQueuedAt : PTY_FLUSH_NORMAL_MS;
	state.lastQueuedAt = now;

	state.flushDelayMs = data.length >= PTY_FAST_BURST_BYTES || deltaMs <= 12 ? PTY_FLUSH_FAST_MS : PTY_FLUSH_NORMAL_MS;

	state.buffer += data;

	let didTruncate = false;
	if (state.buffer.length > PTY_HARD_BUFFER_BYTES) {
		state.buffer =
			PTY_TRUNCATED_NOTICE + state.buffer.slice(Math.max(0, state.buffer.length - PTY_TRIMMED_BUFFER_BYTES));
		didTruncate = !state.truncated;
		state.truncated = true;
	}

	return {
		shouldFlushNow: state.buffer.length >= PTY_SOFT_FLUSH_BYTES,
		didTruncate,
		flushDelayMs: state.flushDelayMs,
	};
}

export function consumePtyOutput(state: PtyBufferState): string {
	const data = state.buffer;
	state.buffer = "";
	state.timer = null;
	state.truncated = false;
	return data;
}
