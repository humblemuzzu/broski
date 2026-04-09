/**
 * Auth session handler.
 * Accepts the cloud session token from the app without entitlement validation.
 * The bridge is open-source — all monetization is app-side (RevenueCat).
 */

import type { ServerWebSocket } from "bun";

type ReplyFn = (msg: any) => void;

export type AuthHandlerContext = {
	ws: ServerWebSocket<unknown>;
	log: (message: string) => void;
};

export async function handleAuth(message: any, reply: ReplyFn, ctx: AuthHandlerContext): Promise<boolean> {
	if (message.type !== "auth_session") return false;

	const { ws, log } = ctx;

	const sessionToken = typeof message.sessionToken === "string" ? message.sessionToken.trim() : "";
	if (sessionToken.length < 10 || sessionToken.length > 1024) {
		log(`[auth_session] REJECT - invalid token length: ${sessionToken.length}`);
		reply({
			type: "error",
			message: "Invalid sessionToken",
			code: "INVALID_SESSION",
			requestId: message.requestId,
		});
		try {
			ws.close(4401, "Invalid session");
		} catch {
			// ignore
		}
		return true;
	}

	log("[auth_session] Accepted (open-source bridge — no entitlement check)");
	reply({
		type: "auth_session_ok",
		data: { entitled: true },
		requestId: message.requestId,
	});

	return true;
}
