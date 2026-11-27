/**
 * One `pi --mode rpc` on the adapter kit's stdio child, whose stop ladder is `docs/rpc.md:91-97`'s: Pi finishes pending
 * work on stdin's end, and a second signal then exits at once, so SIGTERM is sent once. A hosted session's ladder runs in
 * its holder (`holder/`), a probe's in the bridge, and an idle host's stop must end inside the teardown's 5 s
 * (`lifecycle/teardown.ts`). A healthy `pi` is gone in a few hundred ms; a longer wait could only save an OAuth refresh
 * in flight (`CHANGELOG.md:75`), which takes well under a second. Session files are appended synchronously.
 */

import { type RecordSink, StdioChild } from "../../../adapter-kit/stdio-child";
import type { PiEnd, PiTransport } from "./transport";

export interface PiLaunch {
	readonly cliPath: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
}

export class PiProcess extends StdioChild implements PiTransport {
	readonly ended: Promise<PiEnd>;

	constructor(launch: PiLaunch, records: RecordSink) {
		const { cliPath, args, cwd, env } = launch;
		super({ executable: cliPath, args: ["--mode", "rpc", ...args], cwd, env }, records);
		this.ended = this.exited.then((exit) => ({ kind: "exit", exit, stderr: this.stderrTail() }));
	}

	detach(): void {
		void this.stop();
	}
}
