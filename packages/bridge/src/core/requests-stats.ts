import type { Handler } from "./context";
import { rejected } from "./results";

export const NO_STATS = "this bridge tracks no usage stats";

export const statsSummary: Handler<"stats.summary"> = async (ctx, _client, request, respond) => {
	const result = ctx.stats
		? await ctx.stats.summary({
				range: request.range,
				...(request.harness !== undefined && { harness: request.harness }),
				...(request.timeZone !== undefined && { timeZone: request.timeZone }),
				...(request.refresh !== undefined && { refresh: request.refresh }),
			})
		: rejected("unsupported", NO_STATS);
	respond({ type: "stats.summary.result", requestId: request.requestId, result });
};
