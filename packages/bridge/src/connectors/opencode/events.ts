import type { GlobalEvent } from "@opencode-ai/sdk/v2";
import type { OpenCodeContext } from "./context";

export async function startEventStream(
	ctx: OpenCodeContext,
	onEvent: (event: GlobalEvent) => void,
): Promise<AbortController> {
	const controller = new AbortController();
	const { stream } = await ctx.client.global.event({ signal: controller.signal });

	void (async () => {
		try {
			for await (const event of stream) {
				onEvent(event);
			}
		} catch {
			// Stream errors are surfaced via retries inside the SDK.
		}
	})();

	return controller;
}
