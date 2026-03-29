/**
 * Codex config + model-list handler.
 * Extracted from server.ts — cases: cx_config_read, cx_config_value_write, cx_model_list
 */

import type { CodexAppServerClient } from "../../connectors/codex";
import { mapCodexModelToSummary } from "../../runtime/codex-runtime-read-models";

export type CxConfigHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (v: unknown) => string;
};

export async function handleCxConfig(
	message: any,
	reply: (msg: any) => void,
	ctx: CxConfigHandlerContext,
): Promise<boolean> {
	const { ensureCodexClient, safeString } = ctx;

	switch (message.type) {
		case "cx_config_read": {
			const client = await ensureCodexClient();
			const result: any = await client.request("config/read", {
				includeLayers: false,
			});
			reply({ type: "cx_config", data: result ?? {}, requestId: message.requestId });
			return true;
		}
		case "cx_config_value_write": {
			const client = await ensureCodexClient();
			// Codex app-server protocol expects MergeStrategy on the wire as lower-case strings
			// (enum is `Replace|Upsert` in Rust with `rename_all = "camelCase"`).
			const mergeStrategyRaw = safeString(message.mergeStrategy).trim().toLowerCase();
			const mergeStrategy = mergeStrategyRaw === "upsert" ? "upsert" : "replace";
			const result: any = await client.request("config/value/write", {
				keyPath: message.keyPath,
				value: message.value,
				mergeStrategy,
				filePath: null,
				expectedVersion: null,
			});
			reply({ type: "cx_config_written", data: result ?? {}, requestId: message.requestId });
			return true;
		}
		case "cx_model_list": {
			const client = await ensureCodexClient();
			const result: any = await client.request("model/list", {
				cursor: null,
				limit: 200,
				includeHidden: true,
			});
			reply({
				type: "cx_models",
				data: result?.data ?? [],
				nextCursor: result?.nextCursor ?? null,
				requestId: message.requestId,
			});
			reply({
				type: "runtime_models",
				backend: "codex",
				data: (Array.isArray(result?.data) ? result.data : []).map((model: Record<string, unknown>) =>
					mapCodexModelToSummary(model),
				),
				// No requestId — push notification, not a response to a specific request
			});
			return true;
		}
		default:
			return false;
	}
}
