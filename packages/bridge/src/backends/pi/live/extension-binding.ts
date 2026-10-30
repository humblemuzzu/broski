/**
 * A hosted session's `bindExtensions`, which awaits every extension's `session_start` handler (pi-coding-agent
 * `src/core/agent-session.ts:3318-3342`). A handler that asks the human holds it until answered, and the human can
 * answer only once the session is open: the open therefore waits for the binding or for an ask, whichever comes
 * first, and the binding goes on behind the open view (contract README §5 rule 1: the ask is in the snapshot).
 *
 * Pi runs the first `session_start` handler inside the `bindExtensions` call, before it returns a promise
 * (`agent-session.ts:3338-3339`, `extensions/runner.ts:1096-1105`), and that handler can ask at once
 * (`runner.ts:589-590`). So the binding exists, and is pending, before `start` calls Pi: an ask raised from inside
 * the call reaches `noteAsk` on it.
 */

export interface BindingHooks {
	/** The binding failed after the session was opened for a human to answer it. */
	readonly failedLate: (error: unknown) => void;
	/** The binding ended, failed or not. */
	readonly ended: () => void;
}

export class ExtensionBinding {
	private running = true;
	private humanAsked = false;
	private readonly asked = Promise.withResolvers<void>();
	private readonly finished = Promise.withResolvers<void>();
	private bound: Promise<void> | undefined;

	constructor(private readonly hooks: BindingHooks) {}

	/** Settles when the binding ends; never rejects. */
	get done(): Promise<void> {
		return this.finished.promise;
	}

	/** True until every `session_start` handler has returned. */
	get pending(): boolean {
		return this.running;
	}

	/** Calls Pi; once only. */
	start(bind: () => Promise<void>): void {
		if (this.bound !== undefined) throw new Error("the extensions are already being bound");
		const bound = new Promise<void>((resolve) => resolve(bind()));
		this.bound = bound;
		bound
			.catch((error: unknown) => {
				if (this.humanAsked) this.hooks.failedLate(error);
			})
			.finally(() => {
				this.running = false;
				this.finished.resolve();
				this.hooks.ended();
			});
	}

	/** A human is being asked while the handlers run, so the session must open for the answer to come. */
	noteAsk(): void {
		if (!this.running || this.humanAsked) return;
		this.humanAsked = true;
		this.asked.resolve();
	}

	/** Resolves when the binding ends or a human is asked; rejects when the binding failed before either. */
	opened(): Promise<void> {
		if (this.bound === undefined) throw new Error("the extensions are not being bound yet");
		return Promise.race([this.bound, this.asked.promise]);
	}
}
