/** The SDK's session functions throw; the store answers with values (contract README §2 rule 5). */

import type { Rejected } from "../../../contract";
import { rejected } from "../rejections";

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The rejection for a throw: the SDK says "not found" in words, and a read can fail like any file system call. */
function rejectionOf(error: unknown): Rejected {
	const message = messageOf(error);
	return /not found/i.test(message) ? rejected("not_found", message) : rejected("backend_error", message);
}

/** Runs `work` for its effect; a throw becomes a `Rejected`, success is undefined. */
export async function attemptDone(work: () => Promise<unknown>): Promise<Rejected | undefined> {
	try {
		await work();
		return undefined;
	} catch (error) {
		return rejectionOf(error);
	}
}

/** Runs `work`; a throw becomes a `Rejected`. */
export async function attempt<T>(work: () => Promise<T>): Promise<T | Rejected> {
	try {
		return await work();
	} catch (error) {
		return rejectionOf(error);
	}
}
