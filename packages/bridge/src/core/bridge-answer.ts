import { type ActionResult, type InteractionAnswer, type SessionRef, sessionAnswerer } from "../contract";
import { WATCH_ONLY } from "./controlled";
import { settled, within } from "./deadline";
import type { ExternalInteractions } from "./external-interactions";
import type { InteractionDesk } from "./interaction-desk";
import type { CoreClock, CoreLog } from "./ports";
import { REQUEST_DEADLINE_MS } from "./protocol-server";
import { rejected } from "./results";
import type { SessionHub } from "./session-hub";
import { sessionLabel } from "./session-key";

export interface BridgeAnswerDeps {
	readonly hub: SessionHub;
	readonly desk: InteractionDesk;
	readonly externals: ExternalInteractions;
	readonly clock: CoreClock;
	readonly log: CoreLog;
}

/**
 * An answer a person gave somewhere other than a phone attached to the session, such as a decision on
 * a lock screen. It goes where a phone's answer goes (`InteractionDesk.answer`): checked with
 * `answerProblem`, first answer wins, the adapter sees it once. The session must be open: a pending
 * interaction keeps it open, so a session that is not has nothing to answer. A session that can only
 * be watched takes it when it answers without control (`OpenSession.answer`). An ask the bridge raised
 * itself is answered to its asker.
 */
export async function answerFromBridge(
	deps: BridgeAnswerDeps,
	ref: SessionRef,
	answer: InteractionAnswer,
): Promise<ActionResult> {
	const live = deps.hub.find(ref);
	if (!live) return rejected("not_found", "the session is not open");
	const answerer = deps.externals.answerer(live, answer.interactionId) ?? sessionAnswerer(live.open);
	if (!answerer) return rejected("unsupported", WATCH_ONLY);
	const answering = settled(() => deps.desk.answer(live, answerer, answer));
	const outcome = await within(deps.clock, REQUEST_DEADLINE_MS, answering, () => undefined);
	if (outcome === undefined) {
		deps.log.error(`[core] ${sessionLabel(ref)}: the adapter did not take an answer within ${REQUEST_DEADLINE_MS} ms`);
		return rejected("backend_error", "the backend did not take the answer in time");
	}
	if (!outcome.ok) {
		deps.log.error(`[core] ${sessionLabel(ref)}: answering threw: ${outcome.thrown}`);
		return rejected("backend_error", "the backend failed to take the answer");
	}
	return outcome.value;
}
