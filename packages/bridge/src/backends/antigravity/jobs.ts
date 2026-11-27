/**
 * The short jobs (a listing, a catalog probe, a transcript): a plain `agy acp`, started in the void folder, running one
 * job at a time in the order they were asked. A job whose connection failed under it (a deadline, an exit) stops that
 * `agy`, and the next job starts another; a failed job is never run again. `dispose` stops the `agy` at once, so the
 * job running on it fails with its exit, and the jobs queued behind it fail without starting another.
 */

import type { SessionUpdate } from "./acp/frames";
import { INTERNAL_ERROR, type RpcResult, type SessionRoute } from "./acp/rpc";
import { type AgyProcess, SHUT_DOWN, startAgy } from "./agy-process";
import type { AgyInstall } from "./install";

/**
 * A phone screen asks for several reads at once (the models, modes and commands of New Session, then the list), and a
 * cold `agy acp` takes about 2.6 s to its first session: one kept this long after its last job serves the whole burst.
 */
const LINGER_MS = 20_000;

export type JobContext = AgyProcess;

export type Job<T> = (context: JobContext) => Promise<RpcResult<T>>;

export class ShortJobs {
	private tail: Promise<unknown> = Promise.resolve();
	private open: JobContext | undefined;
	private linger: ReturnType<typeof setTimeout> | undefined;
	private readonly shutdown = new AbortController();

	constructor(
		private readonly install: AgyInstall,
		private readonly client: { readonly name: string; readonly version: string },
		/** Where what `agy` sends that breaks the protocol is reported. */
		private readonly log: (message: string) => void,
	) {}

	run<T>(job: Job<T>): Promise<RpcResult<T>> {
		return this.serially(() => this.runNow(job));
	}

	async dispose(): Promise<void> {
		this.shutdown.abort();
		await this.serially(() => this.close());
	}

	private async runNow<T>(job: Job<T>): Promise<RpcResult<T>> {
		clearTimeout(this.linger);
		if (this.shutdown.signal.aborted) return SHUT_DOWN;
		const context = await this.connection();
		if (!context.ok) return context;
		const result = await job(context.result);
		const usable = context.result.acp.running && !this.shutdown.signal.aborted;
		if (!usable || (!result.ok && result.failure.code === undefined)) await this.close();
		else this.linger = setTimeout(() => void this.serially(() => this.close()), LINGER_MS).unref();
		return result;
	}

	private serially<T>(work: () => Promise<T>): Promise<T> {
		const run = this.tail.then(work);
		this.tail = run.catch(() => undefined);
		return run;
	}

	private async connection(): Promise<RpcResult<JobContext>> {
		if (this.open?.acp.running) return { ok: true, result: this.open };
		const started = await startAgy(this.install, {
			args: ["acp"],
			client: this.client,
			log: this.log,
			signal: this.shutdown.signal,
		});
		if (started.ok) this.open = started.result;
		return started;
	}

	private async close(): Promise<void> {
		clearTimeout(this.linger);
		const open = this.open;
		this.open = undefined;
		await open?.acp.stop();
	}
}

/**
 * The route of a session a job opens: what it reads goes to `update`; an ask, which no one would see, is refused; a
 * record that does not read, already reported as a fault, goes to `fault` for a job that counts them.
 */
export function jobRoute(update: (update: SessionUpdate) => void, fault?: (message: string) => void): SessionRoute {
	return {
		update,
		call: (call) =>
			call.answer.error(INTERNAL_ERROR, `${call.method} reached a session the bridge opened only to read`),
		fault: fault ?? (() => undefined),
	};
}
