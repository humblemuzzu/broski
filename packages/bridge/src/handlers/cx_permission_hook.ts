/**
 * Codex Permission Hook handler.
 *
 * Receives permission requests from Codex's PreToolUse shell hook,
 * relays them to the phone app, waits for response, returns decision.
 *
 * NOTE: Codex PreToolUse currently only supports "deny" decisions.
 * "allow" is parsed but NOT supported yet (fails open to normal approval dialog).
 * When the user approves on the phone, we return {} (no-op), letting Codex
 * show its normal terminal approval prompt.
 */
import { randomUUID } from "node:crypto";
import { jsonResponse } from "../http-utils";
import type { ServerMessage } from "../types";

const HOOK_PERMISSION_TIMEOUT_MS = 300_000; // 5 minutes

export type CxPermissionHookContext = {
	broadcast: (msg: ServerMessage) => void;
	logInfo: (msg: string) => void;
	logDebug: (msg: string) => void;
	DEBUG_RTS: boolean;
};

const hookPermissionWaiters = new Map<
	string,
	{ resolve: (decision: "deny" | "allow" | "timeout") => void; timer: Timer }
>();

/**
 * Handle incoming HTTP POST from Codex PreToolUse hook script.
 * The hook script sends the HookInput JSON (what Codex passes to the hook via stdin).
 * We relay to the phone, wait for response, return the decision.
 */
export async function handleCxPermissionHook(request: Request, ctx: CxPermissionHookContext): Promise<Response> {
	if (request.method !== "POST") {
		return jsonResponse({ error: "Method not allowed" }, 405);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonResponse({ error: "Invalid JSON" }, 400);
	}

	const hookEventName = body?.hook_event_name;
	// Only handle PreToolUse hooks
	if (hookEventName !== "PreToolUse") {
		// For other hook types, return empty (don't interfere)
		return jsonResponse({});
	}

	const toolName = typeof body.tool_name === "string" ? body.tool_name : "Bash";
	const toolInput = body.tool_input as Record<string, unknown> | undefined;
	const command = typeof toolInput?.command === "string" ? toolInput.command : "";
	const sessionId = typeof body.session_id === "string" ? body.session_id : "";
	const toolUseId = typeof body.tool_use_id === "string" ? body.tool_use_id : randomUUID();
	const cwd = typeof body.cwd === "string" ? body.cwd : "";

	if (ctx.DEBUG_RTS) {
		ctx.logDebug(
			`[CX Hook] Permission request: tool=${toolName}, command=${command.slice(0, 100)}, session=${sessionId}`,
		);
	}

	const hookRequestId = `cx-hook:${sessionId}:${toolUseId}:${Date.now()}`;

	// Broadcast a runtime_event permission_requested to all connected sockets.
	// We use broadcast (not emitCxStream) because the Codex external terminal
	// doesn't have a thread owner socket — the hook comes from a curl command.
	ctx.broadcast({
		type: "runtime_event",
		backend: "codex",
		data: {
			type: "permission_requested",
			backend: "codex",
			timestampMs: Date.now(),
			sessionId,
			cwd,
			request: {
				requestId: toolUseId,
				kind: toolName,
				title: command ? `Run: ${command}` : `Allow ${toolName}?`,
				metadata: {
					tool: toolName,
					input: toolInput ?? {},
					command,
					hookRequestId,
					method: "item/commandExecution/requestApproval",
					// Structured data for the Flutter UI
					cachedItem: {
						type: "commandExecution",
						command,
					},
				},
			},
		},
	} as ServerMessage);

	ctx.logInfo(`[CX Hook] Waiting for permission response: ${command.slice(0, 80)} (${hookRequestId})`);

	// Wait for the phone's response (or timeout)
	const decision = await new Promise<"deny" | "allow" | "timeout">((resolve) => {
		const timer = setTimeout(() => {
			hookPermissionWaiters.delete(hookRequestId);
			resolve("timeout");
		}, HOOK_PERMISSION_TIMEOUT_MS);
		hookPermissionWaiters.set(hookRequestId, { resolve, timer });
	});

	if (ctx.DEBUG_RTS) {
		ctx.logDebug(`[CX Hook] Permission response: ${decision} for ${command.slice(0, 80)}`);
	}

	if (decision === "deny") {
		// Return deny decision — Codex blocks the command
		return jsonResponse({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: "Denied from Broski app",
			},
		});
	}

	// For "allow" or "timeout", return empty — Codex proceeds with normal approval flow.
	// Codex doesn't support "allow" yet, so we can't skip the terminal dialog.
	return jsonResponse({});
}

/**
 * Resolve a pending CX hook permission by sessionId + toolUseId.
 * Called when the phone responds with a cx_permission_response.
 */
export function resolveCxHookPermissionByToolUse(
	sessionId: string,
	toolUseId: string,
	response: "allow" | "deny",
): boolean {
	// Try matching by prefix (sessionId + toolUseId)
	const prefix = `cx-hook:${sessionId}:${toolUseId}:`;
	for (const [key, waiter] of hookPermissionWaiters) {
		if (key.startsWith(prefix)) {
			clearTimeout(waiter.timer);
			hookPermissionWaiters.delete(key);
			waiter.resolve(response === "deny" ? "deny" : "allow");
			return true;
		}
	}
	// Fallback: match by just toolUseId (session ID might differ between
	// the hook's session_id and the thread ID the app knows)
	for (const [key, waiter] of hookPermissionWaiters) {
		if (key.includes(`:${toolUseId}:`)) {
			clearTimeout(waiter.timer);
			hookPermissionWaiters.delete(key);
			waiter.resolve(response === "deny" ? "deny" : "allow");
			return true;
		}
	}
	return false;
}

/** Check if there are any pending CX hook permissions. */
export function hasPendingCxHookPermissions(): boolean {
	return hookPermissionWaiters.size > 0;
}
