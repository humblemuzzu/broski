/**
 * The short jobs (a listing, a catalog probe, a transcript): a plain `agy acp`, started in the void folder, running one
 * job at a time in the order they were asked. A job whose connection failed under it (a deadline, an exit) stops that
 * `agy`, and the next job starts another; a failed job is never run again.
 */

import { mkdir } from "node:fs/promises";
import { errorText } from "../../adapter-kit/error-text";
import { AcpConnection } from "./acp/connection";
import type { InitializeResult, SessionUpdate } from "./acp/frames";
import type { RpcResult, SessionRoute } from "./acp/rpc";
import type { AgyInstall } from "./install";

/**
 * A phone screen asks for several reads at once (the models, modes and commands of New Session, then the list), and a
 * cold `agy acp` takes about 2.6 s to its first session: one kept this long after its last job serves the whole burst.
 */
const LINGER_MS = 20_000;
const INTERNAL_ERROR = -32603;

export interface JobContext {
	readonly acp: AcpConnection;
	readonly agent: InitializeResult;
}

export type Job<T> = (context: JobContext) => Promise<RpcResult<T>>;

export class ShortJobs {
	private tail: Promise<unknown> = Promise.resolve();
	private open: JobContext | undefined;
	private linger: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(
		private readonly install: AgyInstall,
		private readonly client: { readonly name: string; readonly version: string },
	) {}

	run<T>(job: Job<T>): Promise<RpcResult<T>> {
		return this.serially(() => this.runNow(job));
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.tail;
		await this.close();
	}

	private async runNow<T>(job: Job<T>): Promise<RpcResult<T>> {
		clearTimeout(this.linger);
		if (this.disposed) return { ok: false, failure: { message: "the Antigravity backend has shut down" } };
		const context = await this.connection();
		if (!context.ok) return context;
		const result = await job(context.result);
		if (!context.result.acp.running || (!result.ok && result.failure.code === undefined)) await this.close();
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
		const { cli, env, voidDir } = this.install;
		if (!cli.found) return { ok: false, failure: { message: cli.reason } };
		const made = await mkdir(voidDir, { recursive: true }).then(
			() => undefined,
			(error: unknown) => `the bridge could not make ${voidDir}: ${errorText(error)}`,
		);
		if (made !== undefined) return { ok: false, failure: { message: made } };
		const opened = await AcpConnection.open({
			executable: cli.path,
			args: ["acp"],
			cwd: voidDir,
			env,
			who: "agy",
			client: this.client,
		});
		if (!opened.ok) return opened;
		this.open = { acp: opened.result.connection, agent: opened.result.agent };
		return { ok: true, result: this.open };
	}

	private async close(): Promise<void> {
		clearTimeout(this.linger);
		const open = this.open;
		this.open = undefined;
		await open?.acp.stop();
	}
}

/** The route of a session a job opens: what it reads goes to `update`; an ask, which no one would see, is refused. */
export function jobRoute(update: (update: SessionUpdate) => void, fault?: (message: string) => void): SessionRoute {
	return {
		update,
		call: (call) =>
			call.answer.error(INTERNAL_ERROR, `${call.method} reached a session the bridge opened only to read`),
		fault: fault ?? (() => undefined),
	};
}
