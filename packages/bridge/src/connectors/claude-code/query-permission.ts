import { randomBytes } from "node:crypto";
import type { ElicitationResult, OnElicitation, Options, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResponse } from "../../types";
import type { ElicitationRequestHandler, PermissionRequestHandler, QueryContext } from "./query-context";

type CanUseTool = NonNullable<Options["canUseTool"]>;
type CanUseToolContext = Parameters<CanUseTool>[2];

function buildPermissionRequest(
	ctx: QueryContext,
	toolName: string,
	input: Record<string, unknown>,
	sdkCtx: CanUseToolContext,
) {
	const sid = ctx.sessionId ?? ctx.options.sessionId ?? "";
	const hasSuggestions = Array.isArray(sdkCtx.suggestions) && sdkCtx.suggestions.length > 0;
	return {
		sessionId: sid,
		toolUseId: sdkCtx.toolUseID,
		tool: toolName,
		input,
		decisionReason: sdkCtx.decisionReason,
		blockedPath: sdkCtx.blockedPath,
		hasSuggestions,
		// SDK 0.2.87: Forward full suggestions array for "Always Allow" rule persistence
		...(hasSuggestions ? { suggestions: sdkCtx.suggestions } : {}),
		// SDK 0.2.87: Human-readable fields from the bridge
		...(typeof sdkCtx.title === "string" ? { title: sdkCtx.title } : {}),
		...(typeof sdkCtx.displayName === "string" ? { displayName: sdkCtx.displayName } : {}),
		// Description: prefer SDK-provided, fall back to tool input
		description:
			typeof sdkCtx.description === "string"
				? sdkCtx.description
				: typeof input?.description === "string"
					? input.description
					: undefined,
		agentId: sdkCtx.agentID,
	};
}

function toPermissionResult(
	decision: Awaited<ReturnType<PermissionRequestHandler>>,
	input: Record<string, unknown>,
	sdkCtx: CanUseToolContext,
): PermissionResult {
	const rawResponse = typeof decision === "string" ? decision : decision?.response;
	const response: PermissionResponse =
		rawResponse === "once" || rawResponse === "always" || rawResponse === "reject" ? rawResponse : "reject";
	const updatedInput =
		typeof decision === "object" &&
		decision?.updatedInput &&
		typeof decision.updatedInput === "object" &&
		!Array.isArray(decision.updatedInput)
			? decision.updatedInput
			: input;

	if (response === "reject") {
		return {
			behavior: "deny",
			message: "User denied permission",
			interrupt: true,
			toolUseID: sdkCtx.toolUseID,
			decisionClassification: "user_reject" as const,
		};
	}

	// SDK 0.2.87: Use updatedPermissions from Flutter response if provided,
	// otherwise fall back to SDK suggestions (backward compat)
	const suggestionsFromSdk =
		Array.isArray(sdkCtx.suggestions) && sdkCtx.suggestions.length > 0 ? sdkCtx.suggestions : undefined;
	const permissionsFromDecision =
		typeof decision === "object" && Array.isArray(decision?.updatedPermissions)
			? (decision.updatedPermissions as typeof sdkCtx.suggestions)
			: undefined;
	const updatedPermissions = response === "always" ? (permissionsFromDecision ?? suggestionsFromSdk) : undefined;

	return {
		behavior: "allow" as const,
		updatedInput,
		...(updatedPermissions ? { updatedPermissions } : {}),
		toolUseID: sdkCtx.toolUseID,
		decisionClassification: response === "always" ? ("user_permanent" as const) : ("user_temporary" as const),
	};
}

export function buildCanUseTool(ctx: QueryContext, onPermissionRequest: PermissionRequestHandler): CanUseTool {
	return async (toolName, input, sdkCtx) => {
		// Compliance: honour abort signal — if session was aborted while
		// waiting for permission, reject immediately.
		if (sdkCtx.signal?.aborted) {
			return { behavior: "deny", message: "Session aborted", toolUseID: sdkCtx.toolUseID };
		}
		const decision = await onPermissionRequest(buildPermissionRequest(ctx, toolName, input, sdkCtx));
		return toPermissionResult(decision, input, sdkCtx);
	};
}

function buildElicitationRequest(ctx: QueryContext, request: Parameters<OnElicitation>[0]) {
	return {
		sessionId: ctx.sessionId ?? ctx.options.sessionId ?? "",
		requestId: randomBytes(8).toString("hex"),
		mcpServerName: request.serverName,
		message: request.message,
		mode: request.mode,
		url: request.url,
		elicitationId: request.elicitationId,
		requestedSchema: request.requestedSchema,
	};
}

export function buildOnElicitation(ctx: QueryContext, onElicitationRequest?: ElicitationRequestHandler): OnElicitation {
	return async (request, options): Promise<ElicitationResult> => {
		if (options.signal?.aborted) {
			return { action: "cancel" };
		}

		if (!onElicitationRequest) {
			return { action: "decline" };
		}

		const response = await onElicitationRequest(buildElicitationRequest(ctx, request));

		const action =
			response.action === "accept" || response.action === "decline" || response.action === "cancel"
				? response.action
				: "cancel";

		if (action !== "accept") {
			return { action };
		}

		const content =
			response.content && typeof response.content === "object" && !Array.isArray(response.content)
				? (response.content as Record<string, string | number | boolean | string[]>)
				: undefined;

		return {
			action: "accept" as const,
			...(content ? { content } : {}),
		};
	};
}
