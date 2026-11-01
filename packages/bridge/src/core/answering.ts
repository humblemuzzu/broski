import {
	type ActionResult,
	ADDED_IN_MINOR,
	type OpenSession,
	type SessionAnswerer,
	sessionAnswerer,
} from "../contract";
import type { CoreClient } from "./client";
import { viewed, WATCH_ONLY } from "./controlled";
import { answerTooNew } from "./minor-views";
import { rejected } from "./results";

/**
 * A phone's answer to an ask of a session it views, through the desk. It reaches the session's
 * control, or the session's own `answer` when it can only be watched but takes answers (a terminal's
 * permission prompt). Every other request on such a session stays `unsupported` (`controlled`).
 */
export const interactionAnswer = viewed<"interaction.answer", ActionResult>(
	(request, result) => ({ type: "interaction.answer.result", requestId: request.requestId, result }),
	async ({ ctx, client, request, live }) => {
		const answerer = phoneAnswerer(client, live.open);
		if (!answerer) return rejected("unsupported", WATCH_ONLY);
		return answerTooNew(client, request.answer) ?? ctx.desk.answer(live, answerer, request.answer);
	},
);

/** A client below 1.4 was never told that a watched session takes answers, so its answer goes only to a control. */
function phoneAnswerer(client: CoreClient, open: OpenSession): SessionAnswerer | undefined {
	return open.control ?? (client.speaks(ADDED_IN_MINOR.watchedAnswers) ? sessionAnswerer(open) : undefined);
}
