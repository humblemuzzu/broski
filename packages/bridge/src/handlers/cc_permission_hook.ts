/**
 * CC Permission Hook handler.
 *
 * Receives permission requests from CC's PreToolUse shell hook,
 * relays them to the phone app, waits for response, returns decision.
 *
 * Flow:
 *   1. CC runs a PreToolUse hook (shell command registered in ~/.claude/settings.json)
 *   2. The hook curls POST /cc-hook with the hook input JSON
 *   3. This handler emits a permission_request runtime event to the phone
 *   4. The phone approves/denies via cc_permission_response
 *   5. The waiter resolves and the HTTP response returns the decision to CC
 *   6. CC skips its terminal dialog (allow/deny) based on the hook output
 */
import { randomUUID } from "node:crypto";
import type { ClaudeCodeStreamMessage } from "../types";
import { jsonResponse } from "../http-utils";

const HOOK_PERMISSION_TIMEOUT_MS = 300_000; // 5 minutes

export type CcPermissionHookContext = {
	emitCcStream: (sessionId: string, streamMsg: ClaudeCodeStreamMessage) => void;
	logInfo: (msg: string) => void;
	logDebug: (msg: string) => void;
	DEBUG_RTS: boolean;
};

// Waiters for hook permission responses (hookRequestId -> resolver)
const hookPermissionWaiters = new Map<string, { resolve: (decision: HookDecision) => void; timer: Timer }>();

type HookDecision = {
	permissionDecision: "allow" | "deny" | "ask";
	permissionDecisionReason?: string;
	updatedInput?: unknown;
};

/**
 * Handle incoming HTTP POST from CC PreToolUse hook script.
 * The hook script sends the HookInput JSON (what CC passes to the hook via stdin).
 * We relay to the phone, wait for response, return the decision.
 */
export async function handleCcPermissionHook(request: Request, ctx: CcPermissionHookContext): Promise<Response> {
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
	// Handle PreToolUse (tool execution) and PermissionRequest (permission dialogs incl. AskUserQuestion)
	if (hookEventName !== "PreToolUse" && hookEventName !== "PermissionRequest") {
		// For other hook types, return empty (don't interfere)
		return jsonResponse({});
	}

	const toolName = typeof body.tool_name === "string" ? body.tool_name : "unknown";
	const toolInput = body.tool_input ?? {};
	const sessionId = typeof body.session_id === "string" ? body.session_id : "";
	const toolUseId = typeof body.tool_use_id === "string" ? body.tool_use_id : randomUUID();
	const cwd = typeof body.cwd === "string" ? body.cwd : "";

	if (ctx.DEBUG_RTS) {
		ctx.logDebug(`[CC Hook] Permission request: tool=${toolName}, session=${sessionId}, toolUseId=${toolUseId}`);
	}

	// Generate a unique hook request ID for this specific hook invocation
	const hookRequestId = `hook:${sessionId}:${toolUseId}:${Date.now()}`;

	// Emit the permission request to the phone via the CC stream.
	// Must match the "permission-request" ClaudeCodeStreamMessage type exactly
	// (hyphen, not underscore) so the runtime event mapper handles it correctly.
	ctx.emitCcStream(sessionId, {
		type: "permission-request",
		sessionId,
		toolUseId,
		tool: toolName,
		input: typeof toolInput === "object" && toolInput !== null ? (toolInput as Record<string, unknown>) : {},
		title: formatToolDescription(toolName, toolInput),
		description: formatToolDescription(toolName, toolInput),
	} as ClaudeCodeStreamMessage);

	ctx.logInfo(`[CC Hook] Waiting for permission response: ${toolName} (${hookRequestId})`);

	// Wait for the phone's response (or timeout)
	const decision = await new Promise<HookDecision>((resolve) => {
		const timer = setTimeout(() => {
			hookPermissionWaiters.delete(hookRequestId);
			// Timeout → return "ask" so CC shows the normal terminal dialog
			resolve({
				permissionDecision: "ask",
				permissionDecisionReason: "Broski app timeout",
			});
		}, HOOK_PERMISSION_TIMEOUT_MS);

		hookPermissionWaiters.set(hookRequestId, { resolve, timer });
	});

	if (ctx.DEBUG_RTS) {
		ctx.logDebug(`[CC Hook] Permission response: ${decision.permissionDecision} for ${toolName}`);
	}

	// Return the hook JSON output to CC.
	// CC expects { hookSpecificOutput: { ... } } as the hook's stdout JSON.
	// Use the original hookEventName so CC knows which event this responds to.
	return jsonResponse({
		hookSpecificOutput: {
			hookEventName: hookEventName,
			...decision,
		},
	});
}

/**
 * Resolve a pending hook permission request by hookRequestId.
 * Called when the phone responds with a cc_permission_response that includes hookRequestId.
 */
export function resolveHookPermission(
	hookRequestId: string,
	response: "allow" | "deny",
	reason?: string,
	updatedInput?: unknown,
): boolean {
	const waiter = hookPermissionWaiters.get(hookRequestId);
	if (!waiter) return false;

	clearTimeout(waiter.timer);
	hookPermissionWaiters.delete(hookRequestId);
	waiter.resolve({
		permissionDecision: response === "allow" ? "allow" : "deny",
		permissionDecisionReason: reason,
		updatedInput,
	});
	return true;
}

/**
 * Resolve by sessionId + toolUseId (for compatibility with existing
 * cc_permission_response messages that don't include hookRequestId).
 * Passes updatedInput through for AskUserQuestion answers.
 */
export function resolveHookPermissionByToolUse(
	sessionId: string,
	toolUseId: string,
	response: "allow" | "deny",
	reason?: string,
	updatedInput?: unknown,
): boolean {
	// Find a matching waiter by prefix
	const prefix = `hook:${sessionId}:${toolUseId}:`;
	for (const [key, waiter] of hookPermissionWaiters) {
		if (key.startsWith(prefix)) {
			clearTimeout(waiter.timer);
			hookPermissionWaiters.delete(key);
			waiter.resolve({
				permissionDecision: response === "allow" ? "allow" : "deny",
				permissionDecisionReason: reason,
				...(updatedInput !== undefined ? { updatedInput } : {}),
			});
			return true;
		}
	}
	return false;
}

/** Check if there are any pending hook permissions. */
export function hasPendingHookPermissions(): boolean {
	return hookPermissionWaiters.size > 0;
}

/**
 * Format a human-readable description of what the tool wants to do.
 * Used in the permission request event sent to the phone.
 */
function formatToolDescription(toolName: string, toolInput: unknown): string {
	if (!toolInput || typeof toolInput !== "object") return toolName;
	const input = toolInput as Record<string, unknown>;

	if (toolName === "Bash" || toolName === "bash") {
		const cmd = typeof input.command === "string" ? input.command : "";
		return cmd ? `Run command: ${cmd}` : "Run bash command";
	}
	if (toolName === "Write" || toolName === "Edit") {
		const path = typeof input.file_path === "string" ? input.file_path : "";
		return path ? `${toolName}: ${path}` : toolName;
	}
	return toolName;
}
