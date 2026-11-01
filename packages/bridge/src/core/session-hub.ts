import {
	type ActionResult,
	type AgentBackend,
	type NewSessionOptions,
	type NewSessionResult,
	type OpenResult,
	type OpenSession,
	type OpenTarget,
	type Rejected,
	type SessionRef,
	SessionSnapshot,
	type SinkRecord,
} from "../contract";
import type { CoreClient } from "./client";
import { SESSION_CALL_DEADLINE_MS, type Settled, settled, within } from "./deadline";
import { holdsOpen } from "./keep-open";
import { LiveSession, type LiveSessionDeps } from "./live-session";
import type { Replacements } from "./replacements";
import { rejected } from "./results";
import { sessionKey, sessionLabel } from "./session-key";
import { SessionSinkRouter } from "./session-sink";

export interface HubDeps extends Omit<LiveSessionDeps, "published"> {
	/** How long an idle session nobody views stays open. */
	readonly idleCloseMs: number;
	/** Every event after it reached the viewers, before the hub's own bookkeeping. */
	readonly onEvent: (live: LiveSession, record: SinkRecord, before: SessionSnapshot) => void;
	/** Told which stream replaced which, for a phone that was away. */
	readonly replacements: Replacements;
}

/**
 * The open sessions. A session opens on first use (an attach, or its creation) and holds at most
 * one `OpenSession` at a time (contract README §5, rule 12): it is not opened again until the
 * previous one's `close()` has finished. It closes once nobody views it and it is idle
 * (`holdsOpen`), after `idleCloseMs`; never while work is in flight.
 *
 * An adapter that does not open or close within `SESSION_CALL_DEADLINE_MS` has broken its liveness:
 * the open fails `backend_error` (an `OpenSession` it hands over later is closed at once), and a close
 * stops being waited for, so a wedged call cannot keep the session from ever opening again.
 */
export class SessionHub {
	private readonly live = new Map<string, LiveSession>();
	private readonly opening = new Map<string, Promise<LiveSession | Rejected>>();
	/** Per session, the end of its previous `OpenSession`: a close, or a late open being closed. */
	private readonly closing = new Map<string, Promise<void>>();
	/** How many holders pin each session open with no viewer (`hold`), by session key. */
	private readonly holds = new Map<string, number>();
	private disposed = false;

	constructor(private readonly deps: HubDeps) {}

	/** The live session for `ref`, opening it when nobody has; concurrent callers share one open. */
	acquire(backend: AgentBackend, ref: SessionRef): Promise<LiveSession | Rejected> {
		const key = sessionKey(ref);
		const known = this.live.get(key);
		if (known) return Promise.resolve(known);
		const pending = this.opening.get(key);
		if (pending) return pending;
		const opening = this.openExisting(backend, ref).finally(() => this.opening.delete(key));
		this.opening.set(key, opening);
		return opening;
	}

	/** A new session, open and idle: it closes on its own unless a client attaches in time. */
	async create(backend: AgentBackend, options: NewSessionOptions): Promise<NewSessionResult> {
		const opened = await this.open(backend, { kind: "new", options });
		return opened instanceof LiveSession ? { status: "accepted", session: opened.ref } : opened;
	}

	/**
	 * One more holder of `ref`: the session opens as for an attach, if it is not open, and stays open while held, viewed
	 * or not, as work in flight keeps it. Each hold needs its own `release`. An open that fails takes the hold back.
	 */
	async hold(backend: AgentBackend, ref: SessionRef): Promise<ActionResult> {
		const key = sessionKey(ref);
		this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
		const live = await this.acquire(backend, ref);
		if (!(live instanceof LiveSession)) {
			this.dropHold(key);
			return live;
		}
		this.reviewIdle(live);
		return { status: "accepted" };
	}

	/** One holder of `ref` lets it go; unheld, it closes as any idle session nobody views. */
	release(ref: SessionRef): void {
		const key = sessionKey(ref);
		this.dropHold(key);
		const live = this.live.get(key);
		if (live) this.reviewIdle(live);
	}

	/** The open session `ref` names now, if it is one. */
	find(ref: SessionRef): LiveSession | undefined {
		return this.live.get(sessionKey(ref));
	}

	/** `viewer` stops viewing `live`, which may leave it idle and unviewed. */
	leave(live: LiveSession, viewer: CoreClient): void {
		live.viewers.delete(viewer);
		this.reviewIdle(live);
	}

	/**
	 * Schedules the close of a session that is idle and unviewed, and cancels it once that stops
	 * being so. Every viewer change and every event comes through here, so a timer that fires is right.
	 */
	reviewIdle(live: LiveSession): void {
		const idle = live.viewers.size === 0 && !holdsOpen(live.snapshot) && !this.holds.has(live.key);
		if (idle && !live.cancelIdleClose) {
			live.cancelIdleClose = this.deps.clock.after(this.deps.idleCloseMs, () => {
				live.cancelIdleClose = undefined;
				this.close(live);
			});
		} else if (!idle && live.cancelIdleClose) {
			live.cancelIdleClose();
			live.cancelIdleClose = undefined;
		}
	}

	/** The backend deleted the session: its stream ends and its viewers are let go. */
	remove(ref: SessionRef): void {
		const live = this.live.get(sessionKey(ref));
		if (live) this.close(live);
	}

	/** Bridge shutdown, the one time sessions close while busy; the backends' `dispose` closes them. */
	dispose(): void {
		this.disposed = true;
		for (const live of [...this.live.values()]) this.retire(live);
	}

	private dropHold(key: string): void {
		const left = (this.holds.get(key) ?? 0) - 1;
		if (left > 0) this.holds.set(key, left);
		else this.holds.delete(key);
	}

	private async openExisting(backend: AgentBackend, ref: SessionRef): Promise<LiveSession | Rejected> {
		await this.closing.get(sessionKey(ref));
		return this.open(backend, { kind: "existing", session: ref });
	}

	private async open(backend: AgentBackend, target: OpenTarget): Promise<LiveSession | Rejected> {
		const label = target.kind === "new" ? JSON.stringify(`${backend.id}:new`) : sessionLabel(target.session);
		const sink = new SessionSinkRouter(this.deps.log, label);
		const opening = settled(() => backend.open(target, sink));
		const outcome = await within(this.deps.clock, SESSION_CALL_DEADLINE_MS, opening, () => undefined);
		if (outcome === undefined) {
			this.deps.log.error(
				`[core] ${label}: the adapter did not open the session within ${SESSION_CALL_DEADLINE_MS} ms`,
			);
			this.settleLate(target, opening, label);
			return rejected("backend_error", `the adapter did not open the session within ${SESSION_CALL_DEADLINE_MS} ms`);
		}
		if (!outcome.ok) {
			this.deps.log.error(`[core] ${label}: open threw: ${outcome.thrown}`);
			return rejected("backend_error", `the adapter failed to open the session: ${outcome.thrown}`);
		}
		const result = outcome.value;
		if (result.status === "rejected") return result;
		const checked = SessionSnapshot.safeParse(result.snapshot);
		if (!checked.success || this.disposed) {
			if (!checked.success)
				this.deps.log.error(`[core] ${label}: open gave an invalid snapshot: ${checked.error.message}`);
			await this.closeQuietly(result.session, label);
			return rejected(this.disposed ? "closed" : "backend_error", "the session could not be opened");
		}
		const ref = target.kind === "existing" ? target.session : result.session.session;
		const live = new LiveSession(ref, result.session, result.snapshot, sink, {
			...this.deps,
			published: (session, record, before) => this.published(session, record, before),
		});
		this.live.set(live.key, live);
		sink.deliverTo(live);
		this.reviewIdle(live);
		return live;
	}

	/** An open given up on: the `OpenSession` it brings later is closed, and the session waits for that. */
	private settleLate(target: OpenTarget, opening: Promise<Settled<OpenResult>>, label: string): void {
		const ended = opening.then((late) =>
			late.ok && late.value.status === "accepted" ? this.closeQuietly(late.value.session, label) : undefined,
		);
		if (target.kind === "existing") this.awaitEnd(sessionKey(target.session), ended, label);
	}

	private published(live: LiveSession, record: SinkRecord, before: SessionSnapshot): void {
		const { event } = record;
		this.deps.onEvent(live, record, before);
		if (event.type === "session_replaced") this.replace(live, event.session);
		else this.reviewIdle(live);
	}

	/**
	 * The live session goes on under `ref`: a new stream with its own epoch takes over the
	 * `OpenSession`, its sink and its pending answers. Viewers of the old stream saw its last event,
	 * `session_replaced`, and attach to the new one themselves; a phone that was away is told by
	 * the attach it resumes the old stream with (`Replacements`).
	 */
	private replace(old: LiveSession, ref: SessionRef): void {
		this.retire(old);
		const next = new LiveSession(
			ref,
			old.open,
			old.snapshot,
			old.sink,
			{ ...this.deps, published: (session, record, before) => this.published(session, record, before) },
			old.claims,
		);
		this.deps.replacements.record(old.epoch, ref, next.epoch);
		this.live.set(next.key, next);
		old.sink.deliverTo(next);
		this.reviewIdle(next);
	}

	private close(live: LiveSession): void {
		this.retire(live);
		this.awaitEnd(live.key, this.closeQuietly(live.open, live.label), live.label);
	}

	/** The next open of `key` waits for `ended`, but no longer than the deadline. */
	private awaitEnd(key: string, ended: Promise<void>, label: string): void {
		const bounded = within(this.deps.clock, SESSION_CALL_DEADLINE_MS, ended, () =>
			this.deps.log.error(
				`[core] ${label}: the adapter did not close the session within ${SESSION_CALL_DEADLINE_MS} ms`,
			),
		);
		const done: Promise<void> = bounded.finally(() => {
			if (this.closing.get(key) === done) this.closing.delete(key);
		});
		this.closing.set(key, done);
	}

	/** Takes `live` out of the hub: it gets no more records, and its viewers view it no more. */
	private retire(live: LiveSession): void {
		live.closed = true;
		live.cancelIdleClose?.();
		live.cancelIdleClose = undefined;
		this.live.delete(live.key);
		for (const viewer of live.viewers) viewer.forget(live);
	}

	private async closeQuietly(open: OpenSession, label: string): Promise<void> {
		const closed = await settled(() => open.close());
		if (!closed.ok) this.deps.log.error(`[core] ${label}: close threw: ${closed.thrown}`);
	}
}
