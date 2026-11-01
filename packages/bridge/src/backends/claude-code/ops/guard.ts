/** Nothing throws out of an op: a failure the op did not foresee is a `backend_error` answer. */

import type { BackendCallResult, BackendOpResult, Rejected } from "../../../contract";
import { isRejected, rejected } from "../rejections";

export type OpOutcome = BackendOpResult | Rejected;

export async function guarded(what: string, work: () => Promise<OpOutcome>): Promise<BackendCallResult> {
	try {
		const outcome = await work();
		return isRejected(outcome) ? outcome : { status: "accepted", result: outcome };
	} catch (error) {
		return rejected("backend_error", `${what} failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
