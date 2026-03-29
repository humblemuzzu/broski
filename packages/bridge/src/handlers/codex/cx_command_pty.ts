/**
 * Codex PTY command handler.
 * Handles: cx_command_write, cx_command_resize, cx_command_terminate
 */

import type { CodexAppServerClient } from "../../connectors/codex";

export type CxCommandPtyHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (v: unknown) => string;
};

export async function handleCxCommandPty(
	message: any,
	reply: (msg: any) => void,
	ctx: CxCommandPtyHandlerContext,
): Promise<boolean> {
	const { ensureCodexClient, safeString } = ctx;

	switch (message.type) {
		case "cx_command_write": {
			const client = await ensureCodexClient();
			const processId = safeString(message.processId).trim();
			if (!processId) {
				reply({ type: "error", message: "cx_command_write requires processId", requestId: message.requestId });
				return true;
			}
			await client.request("command/exec/write", {
				processId,
				deltaBase64: message.deltaBase64 ?? undefined,
				closeStdin: message.closeStdin ?? false,
			});
			// Fire-and-forget — no reply needed
			return true;
		}

		case "cx_command_resize": {
			const client = await ensureCodexClient();
			const processId = safeString(message.processId).trim();
			if (!processId) {
				reply({ type: "error", message: "cx_command_resize requires processId", requestId: message.requestId });
				return true;
			}
			await client.request("command/exec/resize", {
				processId,
				size: {
					rows: Number(message.rows ?? 24),
					cols: Number(message.cols ?? 80),
				},
			});
			// Fire-and-forget
			return true;
		}

		case "cx_command_terminate": {
			const client = await ensureCodexClient();
			const processId = safeString(message.processId).trim();
			if (!processId) {
				reply({ type: "error", message: "cx_command_terminate requires processId", requestId: message.requestId });
				return true;
			}
			await client.request("command/exec/terminate", { processId });
			reply({
				type: "cx_command_terminated",
				data: { ok: true, processId },
				requestId: message.requestId,
			});
			return true;
		}

		case "cx_thread_metadata_update": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			if (!threadId) {
				reply({ type: "error", message: "cx_thread_metadata_update requires threadId", requestId: message.requestId });
				return true;
			}
			const gitInfo = message.gitInfo ?? undefined;
			await client.request("thread/metadata/update", { threadId, gitInfo });
			reply({
				type: "cx_thread_metadata_updated",
				data: { ok: true },
				requestId: message.requestId,
			});
			return true;
		}

		default:
			return false;
	}
}
