/** The host's CLI process: started when none runs (first, or after it ended), and the one place that holds it. */

import type {
	Options,
	Query,
	SDKControlInitializeResponse,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { CLOSED, isRejected, rejected } from "../../../adapter-kit/rejections";
import type { Rejected } from "../../../contract";
import type { ClaudeSdk } from "../ports/sdk";
import type { FrameSink } from "./consumer";
import { errorText } from "./error-text";
import { HostProcess } from "./host-process";

export interface ProcessSlotDeps {
	readonly sdk: ClaudeSdk;
	/** The options a process starts with, from the session's state now. */
	readonly launch: () => Promise<Options | Rejected>;
	readonly finished: () => boolean;
	readonly frame: (message: SDKMessage) => void;
	readonly fault: (error: unknown) => void;
	readonly ended: (process: HostProcess, error: unknown) => void;
	/** A launch that started no process: what it was given for the process is let go. */
	readonly unlaunched: () => void;
	readonly initialized: (init: SDKControlInitializeResponse) => void;
}

export class ProcessSlot {
	private process: HostProcess | undefined;
	private starting: Promise<Rejected | undefined> | undefined;

	constructor(private readonly deps: ProcessSlotDeps) {}

	get query(): Query | undefined {
		return this.process?.query;
	}

	/** The process runs and has not been told to close. */
	get alive(): HostProcess | undefined {
		return this.process && !this.process.isClosing ? this.process : undefined;
	}

	push(message: SDKUserMessage): void {
		this.process?.push(message);
	}

	/** Starts a process unless one runs; `Rejected` when it cannot start. */
	ensure(): Promise<Rejected | undefined> {
		if (this.deps.finished()) return Promise.resolve(CLOSED);
		if (this.alive) return Promise.resolve(undefined);
		this.starting ??= this.start().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}

	/** True when `process` was the one the slot held; the slot is then empty. */
	release(process: HostProcess): boolean {
		if (this.process !== process) return false;
		this.process = undefined;
		return true;
	}

	/** Closes the process, if any; it is released when its consumer sees it end. */
	close(): void {
		this.process?.close();
	}

	/** Empties the slot and closes the process it held. */
	async end(): Promise<void> {
		const process = this.process;
		this.process = undefined;
		process?.close();
		await process?.closed();
	}

	private async start(): Promise<Rejected | undefined> {
		await this.process?.closed();
		const options = await this.deps.launch();
		const failure = isRejected(options) ? options : this.deps.finished() ? CLOSED : this.spawn(options);
		if (failure) this.deps.unlaunched();
		return failure;
	}

	private spawn(options: Options): Rejected | undefined {
		const started: { process?: HostProcess } = {};
		const sink: FrameSink = {
			frame: (message) => {
				if (!this.deps.finished() && started.process === this.process) this.deps.frame(message);
			},
			fault: (error) => this.deps.fault(error),
			ended: (error) => {
				if (started.process !== undefined) this.deps.ended(started.process, error);
			},
		};
		try {
			started.process = new HostProcess(this.deps.sdk, options, sink);
		} catch (error) {
			return rejected("backend_error", `Claude Code could not be started: ${errorText(error)}`);
		}
		this.process = started.process;
		started.process.query.initializationResult().then(
			(init) => {
				try {
					this.deps.initialized(init);
				} catch {
					/* the catalogue's news is not worth a process */
				}
			},
			() => undefined,
		);
		return undefined;
	}
}
