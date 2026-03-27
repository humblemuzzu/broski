/**
 * Codex account handler.
 * Extracted from server.ts — cases: cx_account_read, cx_login_start, cx_login_cancel,
 * cx_logout, cx_rate_limits_read, cx_feedback_upload
 */

import type { CodexAppServerClient } from "../../connectors/codex";

export type CxAccountHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
};

export async function handleCxAccount(
	message: any,
	reply: (msg: any) => void,
	ctx: CxAccountHandlerContext,
): Promise<boolean> {
	const { ensureCodexClient } = ctx;

	switch (message.type) {
		case "cx_account_read": {
			const client = await ensureCodexClient();
			const result: any = await client.request("account/read", {
				refreshToken: message.refreshToken === true,
			});
			reply({ type: "cx_account", data: result ?? {} });
			return true;
		}
		case "cx_login_start": {
			const client = await ensureCodexClient();
			const loginType = message.loginType;
			const params = loginType === "apiKey" ? { type: "apiKey", apiKey: message.apiKey ?? "" } : { type: "chatgpt" };
			const result: any = await client.request("account/login/start", params);
			reply({ type: "cx_login_started", data: result ?? {} });
			return true;
		}
		case "cx_login_cancel": {
			const client = await ensureCodexClient();
			const result: any = await client.request("account/login/cancel", {
				loginId: message.loginId,
			});
			reply({ type: "cx_login_canceled", data: result ?? {} });
			return true;
		}
		case "cx_logout": {
			const client = await ensureCodexClient();
			const result: any = await client.request("account/logout");
			reply({ type: "cx_logged_out", data: result ?? {} });
			return true;
		}
		case "cx_rate_limits_read": {
			const client = await ensureCodexClient();
			const result: any = await client.request("account/rateLimits/read");
			reply({ type: "cx_rate_limits", data: result ?? {} });
			return true;
		}
		case "cx_feedback_upload": {
			const client = await ensureCodexClient();
			const result: any = await client.request("feedback/upload", {
				classification: message.classification,
				reason: message.reason ?? null,
				threadId: message.threadId ?? null,
				includeLogs: message.includeLogs === true,
				extraLogFiles: Array.isArray(message.extraLogFiles) ? message.extraLogFiles : undefined,
			});
			reply({ type: "cx_feedback_uploaded", data: result ?? {} });
			return true;
		}
		default:
			return false;
	}
}
