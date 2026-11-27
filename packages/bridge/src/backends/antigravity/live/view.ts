/**
 * The `OpenSession` the core holds for a session this bridge hosts. `close()` detaches the sink and makes every control
 * answer `closed`; the host and its turn go on (contract README §5, rule 3). When the host ends under the view (its
 * worker or the front stopped, or it was closed to make room), the view keeps what it last showed, and the phone's next
 * action loads the session in a new host, whose state replaces it (`resynced`).
 */

import { ACCEPTED, CLOSED, isRejected } from "../../../adapter-kit/rejections";
import type {
	OpenSession,
	Rejected,
	SessionControl,
	SessionRef,
	SessionSink,
	SessionSnapshot,
} from "../../../contract";
import type { AgyHost } from "./host";

export interface ViewDeps {
	/** A new host of the session, its sink not attached yet. */
	readonly reopen: () => Promise<AgyHost | Rejected>;
	/** The view let its host go. */
	readonly closed: (host: AgyHost) => void;
	readonly now: () => number;
}

export class AgyView implements OpenSession {
	readonly control: SessionControl;
	private closed = false;
	private reviving: Promise<Rejected | undefined> | undefined;

	constructor(
		private readonly deps: ViewDeps,
		private host: AgyHost,
		private readonly sink: SessionSink,
	) {
		host.attach(sink);
		this.control = {
			prompt: (input) => this.onHost((live) => live.prompt(input)),
			abort: () => this.whileOpen(async () => (this.host.ended ? ACCEPTED : this.host.abort())),
			answer: (answer) => this.whileOpen(async () => this.host.answer(answer)),
			setModel: (modelId) => this.onHost((live) => live.setModel(modelId)),
			setThinking: (value) => this.onHost((live) => live.setThinking(value)),
			setMode: (axis, value) => this.onHost((live) => live.setMode(axis, value)),
			compact: (instructions) => this.onHost((live) => live.compact(instructions)),
		};
	}

	get session(): SessionRef {
		return { backend: "antigravity", sessionId: this.host.sessionId };
	}

	snapshot(): SessionSnapshot {
		return this.host.snapshot();
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.host.detach(this.sink);
		this.deps.closed(this.host);
	}

	private whileOpen<T>(call: () => Promise<T>): Promise<T | Rejected> {
		return this.closed ? Promise.resolve(CLOSED) : call();
	}

	private async onHost<T extends object>(call: (host: AgyHost) => T | Promise<T>): Promise<T | Rejected> {
		if (this.closed) return CLOSED;
		const revived = await this.reviveIfEnded();
		if (revived !== undefined) return revived;
		return this.closed ? CLOSED : call(this.host);
	}

	private reviveIfEnded(): Promise<Rejected | undefined> {
		if (!this.host.ended) return Promise.resolve(undefined);
		this.reviving ??= this.revive().finally(() => {
			this.reviving = undefined;
		});
		return this.reviving;
	}

	private async revive(): Promise<Rejected | undefined> {
		const host = await this.deps.reopen();
		if (isRejected(host)) return host;
		if (this.closed) {
			this.deps.closed(host);
			return CLOSED;
		}
		this.host.detach(this.sink);
		this.host = host;
		this.sink.emit({ at: this.deps.now(), event: { type: "resynced", snapshot: host.snapshot() } });
		host.attach(this.sink);
		return undefined;
	}
}
