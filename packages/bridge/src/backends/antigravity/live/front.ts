/**
 * The live front: one `agy acp --process-per-session`, started on first need, serving each hosted session from a worker
 * of its own (agy 1.5.18: a worker's loss leaves the other sessions working, the front's takes every worker with it).
 * Its exit is told once to `exited`, and the next caller starts another. The shutdown signal stops it through the stop
 * ladder (`adapter-kit/stdio-child.ts`).
 */

import type { RpcResult } from "../acp/rpc";
import { type AgyProcess, SHUT_DOWN, startAgy } from "../agy-process";
import type { AgyInstall } from "../install";

export interface FrontOptions {
	readonly client: { readonly name: string; readonly version: string };
	readonly log: (message: string) => void;
	readonly signal: AbortSignal;
	/** The front exited without being asked to, with why. */
	readonly exited: (reason: string) => void;
}

export class AgyFront {
	private current: Promise<RpcResult<AgyProcess>> | undefined;

	constructor(
		private readonly install: AgyInstall,
		private readonly options: FrontOptions,
	) {}

	connection(): Promise<RpcResult<AgyProcess>> {
		if (this.options.signal.aborted) return Promise.resolve(SHUT_DOWN);
		this.current ??= this.start();
		return this.current;
	}

	/** Once the front, if one runs, has exited. */
	async stopped(): Promise<void> {
		const started = await this.current;
		if (started?.ok) await started.result.acp.stop();
	}

	private async start(): Promise<RpcResult<AgyProcess>> {
		const { client, log, signal } = this.options;
		const started = await startAgy(this.install, { args: ["acp", "--process-per-session"], client, log, signal });
		const mine = this.current;
		if (!started.ok) {
			if (this.current === mine) this.current = undefined;
			return started;
		}
		void started.result.acp.ended.then((reason) => {
			if (this.current === mine) this.current = undefined;
			if (!signal.aborted) this.options.exited(reason);
		});
		return started;
	}
}
