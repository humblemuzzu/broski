/**
 * Drains one native PTY master fd without ever blocking the JS thread.
 *
 * The obvious implementation — `poll(fd, timeout)` through `bun:ffi` — runs the wait on the JS
 * thread, so a single idle session held every timer in the process for the length of the timeout.
 * Handing the fd to Bun's event loop instead parks for free while the session is idle, and still
 * wakes on the two ways a PTY master finishes: EOF and EIO (once the child is gone).
 */

export type PtyReaderOptions = {
	fd: number;
	/** Raw bytes as the child wrote them: a chunk may end inside a UTF-8 character or an escape sequence. */
	onData: (bytes: Uint8Array) => void;
	onEnd: () => void;
};

export type PtyReader = {
	/**
	 * Cancels the stream and resolves once it can no longer read from the fd, so the caller may
	 * close or reuse the descriptor. Reports the end exactly once, like a natural end does.
	 */
	stop: () => Promise<void>;
};

export function createPtyReader(options: PtyReaderOptions): PtyReader {
	const reader = Bun.file(options.fd).stream().getReader();

	let ended = false;
	let resolveEnded: () => void = () => {};
	const endedSignal = new Promise<void>((resolve) => {
		resolveEnded = resolve;
	});
	const finish = (): void => {
		if (ended) return;
		ended = true;
		resolveEnded();
		options.onEnd();
	};

	void (async () => {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value?.length) options.onData(value);
			}
		} catch {
			// The child exiting closes the master: EIO or a clean EOF.
		}
		finish();
	})();

	return {
		stop: async () => {
			if (ended) return;
			await reader.cancel().catch(() => {});
			await endedSignal;
		},
	};
}
