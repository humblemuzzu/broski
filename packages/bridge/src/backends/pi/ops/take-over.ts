/**
 * `backend.call` `take_over` (contract README §13): a session another client wrote becomes one this bridge may drive.
 * The person has said that no terminal is using it; the adapter checks what it can. It refuses while a terminal `pi`
 * that runs the Broski link extension has the file open, and while the file changed a moment ago, because Pi keeps no
 * lock on a session file and a second writer would interleave entries. The mark is the `broski.origin` entry a
 * session this bridge creates starts with.
 */

import { stat } from "node:fs/promises";
import type { BackendCallResult, TakeOverOp } from "../../../contract";
import { errorText } from "../error-text";
import { isDirectory } from "../is-directory";
import type { OwnershipAccess, SessionStore, TerminalPresence } from "../ports";
import { ACCEPTED, rejected } from "../rejections";

/** A session file written to within this long may still be written to by something. */
export const RECENT_WRITE_MS = 10_000;

export interface TakeOverDeps {
	readonly hosts: OwnershipAccess;
	readonly store: Pick<SessionStore, "claim">;
	readonly terminals: TerminalPresence;
	readonly now: () => number;
}

const TAKEN_OVER: BackendCallResult = { status: "accepted", result: { kind: "take_over" } };

export async function takeOver(deps: TakeOverDeps, op: TakeOverOp): Promise<BackendCallResult> {
	const result = await deps.hosts.takeOver(op.sessionId, async (stored) => {
		const holder = deps.terminals.holder(stored.path);
		if (holder !== undefined) {
			return rejected("busy", `A terminal pi (process ${holder.pid}) has this session open. Close it there first.`);
		}
		if (stored.origin === "broski") return ACCEPTED;
		if (stored.cwd === undefined || !isDirectory(stored.cwd)) {
			return rejected("not_found", "The session's working directory is gone, so it cannot run from here.");
		}
		const changedAgo = await sinceLastWrite(stored.path, deps.now());
		if (typeof changedAgo !== "number") return changedAgo;
		if (changedAgo < RECENT_WRITE_MS) {
			return rejected(
				"busy",
				"This session's file changed a moment ago, so something may still be writing to it. Try again shortly.",
			);
		}
		return deps.store.claim(stored.sessionId);
	});
	return result.status === "accepted" ? TAKEN_OVER : result;
}

async function sinceLastWrite(path: string, now: number): Promise<number | ReturnType<typeof rejected>> {
	try {
		return now - (await stat(path)).mtimeMs;
	} catch (error) {
		return rejected("backend_error", `The session file could not be read: ${errorText(error)}`);
	}
}
