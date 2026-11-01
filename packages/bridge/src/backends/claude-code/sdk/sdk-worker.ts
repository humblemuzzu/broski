/** The worker thread `worker-client.ts` starts: the SDK's session functions under the environment it was given (D36). */

import { parentPort } from "node:worker_threads";
import { dispatch } from "./dispatch";
import { IN_PROCESS } from "./in-process";
import type { WorkerCall } from "./worker-protocol";

const port = parentPort;
if (port) {
	port.on("message", (call: WorkerCall) => {
		void dispatch(IN_PROCESS, call).then((reply) => port.postMessage(reply));
	});
}
