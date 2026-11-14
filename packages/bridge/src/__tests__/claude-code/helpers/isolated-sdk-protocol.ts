/** The messages between `isolated-sdk.ts` and `isolated-sdk-worker.ts`: one call of a `SessionFunctions` member each way. */

import type { SessionFunctions } from "../../../backends/claude-code/ports/sdk";

export type SessionFunctionName = keyof SessionFunctions;

export type WorkerCall = {
	[K in SessionFunctionName]: { readonly id: number; readonly fn: K; readonly args: Parameters<SessionFunctions[K]> };
}[SessionFunctionName];

export type WorkerReply =
	| {
			[K in SessionFunctionName]: {
				readonly id: number;
				readonly fn: K;
				readonly ok: true;
				readonly value: Awaited<ReturnType<SessionFunctions[K]>>;
			};
	  }[SessionFunctionName]
	| { readonly id: number; readonly fn: SessionFunctionName; readonly ok: false; readonly message: string };
