/**
 * The adapter as the suite sees it, plus what the driver needs to watch: every session's control by id (a scenario
 * that must switch the mode first) and when anything was last emitted (`quiesce`). Methods are copied, never added,
 * so the derived capabilities stay the adapter's.
 */

import type { AgentBackend, SessionControl, SessionSink } from "../../../contract";

export class Activity {
	private last = Date.now();

	touch(): void {
		this.last = Date.now();
	}

	/** Resolves once nothing was emitted for `quietMs` and `busy()` is false. */
	async settle(busy: () => boolean, quietMs = 300, limitMs = 20_000): Promise<void> {
		const until = Date.now() + limitMs;
		while (Date.now() < until) {
			if (!busy() && Date.now() - this.last >= quietMs) return;
			await Bun.sleep(25);
		}
	}
}

export interface Observed {
	readonly backend: AgentBackend;
	readonly controls: Map<string, SessionControl>;
}

export function observe(backend: AgentBackend, activity: Activity): Observed {
	const controls = new Map<string, SessionControl>();
	const watched = (sink: SessionSink): SessionSink => ({
		emit: (record) => {
			activity.touch();
			sink.emit(record);
		},
	});
	const observed: AgentBackend = {
		...backend,
		open: async (target, sink) => {
			const opened = await backend.open(target, watched(sink));
			if (opened.status === "accepted" && opened.session.control) {
				controls.set(opened.session.session.sessionId, opened.session.control);
			}
			return opened;
		},
	};
	return { backend: observed, controls };
}
