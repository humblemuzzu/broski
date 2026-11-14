/**
 * Drains one native PTY master fd without ever blocking the JS thread.
 *
 * The obvious implementation — `poll(fd, timeout)` through `bun:ffi` — runs the wait on the JS
 * thread, so a single idle session held every timer in the process for the length of the timeout.
 * Handing the fd to Bun's event loop instead parks for free while the session is idle, and still
 * wakes on the two ways a PTY master finishes: EOF (macOS) and EIO (Linux, once the child is gone).
 */

export type PtyReaderOptions = {
	fd: number;
	onData: (text: string) => void;
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
	const decoder = new TextDecoder();

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
				if (value?.length) {
					// A chunk can split a UTF-8 sequence, so the decoder carries the remainder over.
					const text = decoder.decode(value, { stream: true });
					if (text) options.onData(text);
				}
			}
		} catch {
			// The child exiting closes the master: EIO on Linux, a clean EOF on macOS.
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
