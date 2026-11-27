/**
 * The `OpenSession` the core holds for a session this bridge hosts. `close()` detaches the sink and makes every control
 * answer `closed`; the host and its turn go on (contract README §5, rule 3). When the host ends under the view (its
 * worker or the front stopped, or it was closed to make room), the view keeps what it last showed, and the phone's next
 * action loads the session in a new host, whose state replaces it (`resynced`). A session agy lost before it stored it
 * goes on as the one made in its place: `input_returned` hands the person back what agy never kept, and
 * `session_replaced` names the new session, last under the old one.
 */

import { ACCEPTED, CLOSED, isRejected } from "../../../adapter-kit/rejections";
import type {
	AgentEvent,
	OpenSession,
	Rejected,
	SessionControl,
	SessionRef,
	SessionSink,
	SessionSnapshot,
} from "../../../contract";
import type { AgyHost } from "./host";

/** A session hosted again; `returned` when agy had lost it and `host` is a new session made in its place. */
export interface Reopened {
	readonly host: AgyHost;
	/** What the person wrote in the lost session that agy never kept, for their composer. */
	readonly returned?: readonly string[];
}

export interface ViewDeps {
	/** The session hosted anew, its sink not attached yet. */
	readonly reopen: (sessionId: string) => Promise<Reopened | Rejected>;
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

	/**
	 * The view was opened under the lost session's id. The replacement goes out once the core holds the view, whose
	 * attach is answered within the microtasks after `open` resolves, so the phone that attached sees it.
	 */
	replacedOnOpen(returned: readonly string[]): void {
		setTimeout(() => {
			if (!this.closed) this.replaced(returned);
		}, 0);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.host.detach(this.sink);
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
		const reopened = await this.deps.reopen(this.host.sessionId);
		if (isRejected(reopened)) return reopened;
		if (this.closed) return CLOSED;
		const { host, returned } = reopened;
		this.host.detach(this.sink);
		this.host = host;
		this.emit({ type: "resynced", snapshot: host.snapshot() });
		host.attach(this.sink);
		if (returned !== undefined) this.replaced(returned);
		return undefined;
	}

	private replaced(returned: readonly string[]): void {
		const texts = returned.filter((text) => text !== "");
		if (texts.length > 0) this.emit({ type: "input_returned", texts });
		this.emit({ type: "session_replaced", session: this.session });
	}

	private emit(event: AgentEvent): void {
		this.sink.emit({ at: this.deps.now(), event });
	}
}
