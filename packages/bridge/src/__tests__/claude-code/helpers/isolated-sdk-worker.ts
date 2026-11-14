/** The worker thread `isolated-sdk.ts` starts: the bridge's own session functions under the environment it was given. */

import { parentPort } from "node:worker_threads";
import type { SessionFunctions } from "../../../backends/claude-code/ports/sdk";
import { createClaudeSdk } from "../../../backends/claude-code/sdk/claude-sdk";
import type { WorkerCall, WorkerReply } from "./isolated-sdk-protocol";

/** Runs one call on `fns` and words the outcome as a reply; never throws. */
async function dispatch(fns: SessionFunctions, call: WorkerCall): Promise<WorkerReply> {
	const { id } = call;
	try {
		switch (call.fn) {
			case "listSessions":
				return { id, fn: call.fn, ok: true, value: await fns.listSessions(...call.args) };
			case "getSessionInfo":
				return { id, fn: call.fn, ok: true, value: await fns.getSessionInfo(...call.args) };
			case "getSessionMessages":
				return { id, fn: call.fn, ok: true, value: await fns.getSessionMessages(...call.args) };
			case "getSubagentMessages":
				return { id, fn: call.fn, ok: true, value: await fns.getSubagentMessages(...call.args) };
			case "listSubagents":
				return { id, fn: call.fn, ok: true, value: await fns.listSubagents(...call.args) };
			case "forkSession":
				return { id, fn: call.fn, ok: true, value: await fns.forkSession(...call.args) };
			case "renameSession":
				return { id, fn: call.fn, ok: true, value: await fns.renameSession(...call.args) };
			case "resolveSettings":
				return { id, fn: call.fn, ok: true, value: await fns.resolveSettings(...call.args) };
		}
	} catch (error) {
		return { id, fn: call.fn, ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}

const port = parentPort;
if (port) {
	const sdk = createClaudeSdk();
	port.on("message", (call: WorkerCall) => {
		void dispatch(sdk, call).then((reply) => port.postMessage(reply));
	});
}
