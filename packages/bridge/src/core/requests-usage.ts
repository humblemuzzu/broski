import type { Handler } from "./context";
import { rejected } from "./results";

export const NO_USAGE = "this bridge reads no plan usage";

export const planUsage: Handler<"plan.usage"> = async (ctx, _client, request, respond) => {
	const result = ctx.usage ? await ctx.usage.read() : rejected("unsupported", NO_USAGE);
	respond({ type: "plan.usage.result", requestId: request.requestId, result });
};
