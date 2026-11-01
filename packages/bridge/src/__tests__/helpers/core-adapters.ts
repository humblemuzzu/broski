/**
 * Adapters that differ from the fake in one way, as a buggy or slow adapter would: each wraps the
 * fake and changes one behaviour, so a test breaks the adapter, never the core.
 */

import type {
	ActionResult,
	AgentBackend,
	InteractionAnswer,
	OpenSession,
	SessionControl,
	SessionSink,
	SinkRecord,
} from "../../contract";

/** `backend` with every `OpenSession` it opens passed through `wrap`; everything else is `backend`'s. */
export function wrappingSessions(backend: AgentBackend, wrap: (session: OpenSession) => OpenSession): AgentBackend {
	return {
		...backend,
		open: async (target, sink) => {
			const result = await backend.open(target, sink);
			return result.status === "rejected" ? result : { ...result, session: wrap(result.session) };
		},
	};
}

export interface SessionChanges {
	readonly snapshot?: OpenSession["snapshot"];
	readonly close?: OpenSession["close"];
	/** Applied to the session's control, when it has one. */
	readonly control?: (control: SessionControl) => SessionControl;
}

/** `session`, with `changes` in place of what they name. */
export function changedSession(session: OpenSession, changes: SessionChanges): OpenSession {
	const control = session.control && (changes.control ? changes.control(session.control) : session.control);
	return {
		get session() {
			return session.session;
		},
		snapshot: changes.snapshot ?? (() => session.snapshot()),
		...(control && { control }),
		close: changes.close ?? (() => session.close()),
	};
}

/** What the core did with the adapter's sessions, recorded by a wrapper around `open`. */
export interface OpenRecord {
	readonly opened: string[];
	readonly closed: string[];
}

/** `backend` with every `open` and `close` recorded by session id; it behaves exactly as `backend` does. */
export function recordingOpens(backend: AgentBackend, record: OpenRecord): AgentBackend {
	return wrappingSessions(backend, (session) => {
		record.opened.push(session.session.sessionId);
		return changedSession(session, {
			close: () => {
				record.closed.push(session.session.sessionId);
				return session.close();
			},
		});
	});
}

/** `backend` with every answer its sessions are given recorded; it behaves exactly as `backend` does. */
export function recordingAnswers(backend: AgentBackend, answers: InteractionAnswer[]): AgentBackend {
	return wrappingSessions(backend, (session) =>
		changedSession(session, {
			control: (control) => ({
				...control,
				answer: (answer) => {
					answers.push(answer);
					return control.answer(answer);
				},
			}),
		}),
	);
}

/** An adapter whose `snapshot()` reports another model once `drifting` says so. */
export function driftingSnapshots(drifting: () => boolean): (backend: AgentBackend) => AgentBackend {
	return (backend) =>
		wrappingSessions(backend, (session) =>
			changedSession(session, {
				snapshot: () => (drifting() ? { ...session.snapshot(), modelId: "drifted" } : session.snapshot()),
			}),
		);
}

/** An adapter whose `snapshot()` throws once `broken` says so. */
export function throwingSnapshots(backend: AgentBackend, broken: () => boolean): AgentBackend {
	return wrappingSessions(backend, (session) =>
		changedSession(session, {
			snapshot: () => {
				if (broken()) throw new Error("no snapshot");
				return session.snapshot();
			},
		}),
	);
}

/** An adapter that emits every text delta with an empty block id, which the contract refuses. */
export function corruptingDeltas(backend: AgentBackend): AgentBackend {
	return {
		...backend,
		open: (target, sink) => {
			const corrupting: SessionSink = {
				emit: (record: SinkRecord) =>
					sink.emit(
						record.event.type === "block_delta" ? { ...record, event: { ...record.event, blockId: "" } } : record,
					),
			};
			return backend.open(target, corrupting);
		},
	};
}

/** An adapter that emits a notice in the microtask after `open` resolves, as a busy backend may. */
export function noticeRightAfterOpen(backend: AgentBackend): AgentBackend {
	return {
		...backend,
		open: async (target, sink) => {
			const result = await backend.open(target, sink);
			queueMicrotask(() => sink.emit({ at: 1, event: { type: "notice", level: "info", text: "right after open" } }));
			return result;
		},
	};
}

/** The fake with no memory of prompt ids, as Pi has none: only the core can tell a repeat. */
export function forgetfulPrompts(backend: AgentBackend): AgentBackend {
	return wrappingSessions(backend, (session) =>
		changedSession(session, {
			control: (control) => ({
				...control,
				prompt: (input) => control.prompt({ ...input, clientRequestId: crypto.randomUUID() }),
			}),
		}),
	);
}

/** The fake, except that `abort` throws, as an adapter with a bug would. */
export function throwingAborts(backend: AgentBackend): AgentBackend {
	return wrappingSessions(backend, (session) =>
		changedSession(session, {
			control: (control) => ({
				...control,
				abort: async (): Promise<ActionResult> => {
					throw new Error("kaput");
				},
			}),
		}),
	);
}

/** A promise per call that the test settles: how a slow or wedged adapter call is made. */
export class Gate<T> {
	private readonly waiting: Array<(value: T) => void> = [];
	private notify: (() => void) | undefined;

	/** A call that waits for the test. */
	hold(): Promise<T> {
		return new Promise<T>((resolve) => {
			this.waiting.push(resolve);
			this.notify?.();
		});
	}

	count(): number {
		return this.waiting.length;
	}

	/** Resolves once a call is waiting. */
	arrived(): Promise<void> {
		if (this.waiting.length > 0) return Promise.resolve();
		return new Promise<void>((resolve) => {
			this.notify = () => {
				this.notify = undefined;
				resolve();
			};
		});
	}

	/** Lets the oldest waiting call go with `value`. */
	pass(value: T): void {
		const next = this.waiting.shift();
		if (!next) throw new Error("no call is waiting");
		next(value);
	}
}
