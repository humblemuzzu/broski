import { type ActionResult, sessionAnswerer } from "../contract";
import { viewed, WATCH_ONLY } from "./controlled";
import { rejected } from "./results";

/**
 * A phone's answer to an ask of a session it views, through the desk. It reaches the session's
 * control, or the session's own `answer` when it can only be watched but takes answers (a terminal's
 * permission prompt). Every other request on such a session stays `unsupported` (`controlled`).
 */
export const interactionAnswer = viewed<"interaction.answer", ActionResult>(
	(request, result) => ({ type: "interaction.answer.result", requestId: request.requestId, result }),
	async ({ ctx, request, live }) => {
		const answerer = live.open.control ?? sessionAnswerer(live.open);
		if (!answerer) return rejected("unsupported", WATCH_ONLY);
		return ctx.desk.answer(live, answerer, request.answer);
	},
);
