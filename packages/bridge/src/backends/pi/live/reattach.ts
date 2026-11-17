/**
 * Taking a session's holder over again after this bridge lost its socket while `pi` ran on (`holder/`, `SessionHost`'s
 * `detached`). One attempt is an adoption under the session lock; the waits between attempts hold no lock, so the
 * session's opens and prompts go on between them (`SessionLocks` is a plain queue).
 */

import type { Rejected, RunOutcome } from "../../../contract";
import { rejected } from "../rejections";
import type { SessionHost } from "./session-host";

/** What the session takes while its holder is being taken over again: nothing yet, so it is worth another try. */
export const RECONNECTING: Rejected = rejected(
	"busy",
	"the bridge is reconnecting to this session's Pi; try again in a moment",
);

function unavailable(message: string): RunOutcome {
	return { kind: "error", error: { code: "backend_unavailable", message } };
}

/**
 * The holder of `lost`'s session taken over again, after which the view moves to the new host (`adopted`). When that
 * fails `lost` ends its run, and the view's next action starts the session again (`SessionView`), taking over the
 * holder if one still runs it.
 */
export async function reattachLost(
	lost: SessionHost,
	deps: {
		readonly attempt: () => Promise<Adoption>;
		/** Before anyone is told: `lost` no longer stands for the session. */
		readonly settled: () => void;
		readonly adopted: () => void;
	},
): Promise<void> {
	const outcome = await reattach(deps.attempt);
	deps.settled();
	if (outcome.kind === "adopted") deps.adopted();
	else if (outcome.kind === "gone") lost.abandon(unavailable("Pi stopped while the bridge was reconnecting to it."));
	else if (outcome.kind === "failed") {
		lost.abandon(
			unavailable(
				`The bridge could not reconnect to this session's Pi (${outcome.why}). It may still be running: open the session again to reconnect.`,
			),
		);
	}
}

/** Before each attempt: at once, then backing off, about 7.5 s in all. */
export const REATTACH_DELAYS_MS: readonly number[] = [0, 500, 1_000, 2_000, 4_000];

/** An adoption's answer: the host, a refusal (`busy` is worth another try), or no holder at all. */
export type Adoption = SessionHost | Rejected | undefined;

export type Reattached =
	| { readonly kind: "adopted"; readonly host: SessionHost }
	/** No holder runs the session any more: its `pi` ended while this bridge was away. */
	| { readonly kind: "gone" }
	/** The bridge is shutting down. */
	| { readonly kind: "closed" }
	| { readonly kind: "failed"; readonly why: string };

export async function reattach(
	attempt: () => Promise<Adoption>,
	delays: readonly number[] = REATTACH_DELAYS_MS,
): Promise<Reattached> {
	let why = "the session's holder did not answer";
	for (const delay of delays) {
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		const adopted = await attempt();
		if (adopted === undefined) return { kind: "gone" };
		if (!("status" in adopted)) return { kind: "adopted", host: adopted };
		const { code, message } = adopted.rejection;
		if (code === "closed") return { kind: "closed" };
		if (code !== "busy") return { kind: "failed", why: message };
		why = message;
	}
	return { kind: "failed", why };
}
