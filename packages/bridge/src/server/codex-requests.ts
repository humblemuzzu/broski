import type { ServerWebSocket } from "bun";
import type { CodexServerRequest } from "../connectors/codex";
import { buildCodexApprovalDecision } from "../handlers/codex/approval-decision";
import type { CodexStreamMessage } from "../types";
import { type PermissionWaiter, waitForPermission } from "./permission-waiter";
import type { CodexApprovalReply } from "./state";
import type { Streams } from "./streams";
import { safeString } from "./util";

/** The state a Codex request handler reads and mutates. */
export type CodexRequestState = {
	cxItemCache: Map<string, any>;
	cxThreadOwners: Map<string, ServerWebSocket<unknown>>;
	cxApprovalWaiters: Map<string, PermissionWaiter<CodexApprovalReply>>;
};

export type CodexRequestDeps = {
	state: CodexRequestState;
	emitCxStream: Streams["emitCxStream"];
	logInfo: (message: string) => void;
	permissionTimeoutMs: number;
};

/**
 * The bridge's reaction to a Codex app-server request: approvals (turned into a UI prompt and an
 * await on the waiter map), unsupported dynamic tools, and auth-token refresh.
 */
export function createCodexRequestHandler(deps: CodexRequestDeps): (r: CodexServerRequest) => Promise<unknown> {
	const { state } = deps;

	return async (r: CodexServerRequest): Promise<unknown> => {
		const params: any = r.params ?? {};
		const requestMethod = String(r.method ?? "");
		const isLegacyPatchApproval = requestMethod === "applyPatchApproval";
		const isLegacyExecApproval = requestMethod === "execCommandApproval";
		const isLegacyApproval = isLegacyPatchApproval || isLegacyExecApproval;

		let threadId = safeString(
			params.threadId ?? params.thread_id ?? params.threadID ?? params.conversationId ?? params.conversation_id,
		);
		let turnId = safeString(params.turnId ?? params.turn_id ?? params.turnID);
		const itemId = safeString(params.itemId ?? params.item_id ?? params.itemID ?? params.callId);

		// skill/requestApproval does not currently include threadId in protocol params.
		// Recover it from cached item events: key format `${threadId}:${turnId}:${itemId}`.
		if (!threadId && requestMethod === "skill/requestApproval" && itemId) {
			for (const key of state.cxItemCache.keys()) {
				if (key.endsWith(`:${itemId}`)) {
					const [resolvedThreadId, resolvedTurnId] = key.split(":");
					threadId = resolvedThreadId ?? "";
					if (!turnId) turnId = resolvedTurnId ?? "";
					break;
				}
			}
		}
		if (!threadId && requestMethod === "skill/requestApproval" && state.cxThreadOwners.size === 1) {
			threadId = Array.from(state.cxThreadOwners.keys())[0] ?? "";
		}

		const owner = threadId ? state.cxThreadOwners.get(threadId) : null;

		// ── Handle item/tool/call (dynamic tool calls) ──
		// Protocol: DynamicToolCallParams = { threadId, turnId, callId, tool, arguments }
		// Response: DynamicToolCallResponse = { contentItems: DynamicToolCallOutputContentItem[], success: boolean }
		// We don't support dynamic tools yet — return a graceful error response
		if (requestMethod === "item/tool/call") {
			deps.logInfo(`[Codex] Dynamic tool call received: ${safeString(params.tool)} — not supported, declining`);
			if (owner) {
				// Route through emitCxStream for runtime_event mapping
				deps.emitCxStream(
					threadId,
					{
						type: "info",
						message: `Dynamic tool "${safeString(params.tool)}" was requested but is not yet supported by Broski.`,
					} satisfies CodexStreamMessage,
					owner,
				);
			}
			return {
				contentItems: [
					{
						type: "inputText",
						text: "Dynamic tool calls are not yet supported by Broski.",
					},
				],
				success: false,
			};
		}

		// ── Handle account/chatgptAuthTokens/refresh ──
		// Protocol: ChatgptAuthTokensRefreshParams = { reason, previousAccountId? }
		// Response: ChatgptAuthTokensRefreshResponse = { accessToken, chatgptAccountId, chatgptPlanType }
		// We don't manage ChatGPT auth tokens — return an error so Codex falls back
		if (requestMethod === "account/chatgptAuthTokens/refresh") {
			deps.logInfo(`[Codex] ChatGPT auth token refresh requested — not supported`);
			throw new Error("ChatGPT auth token refresh is not supported by Broski. Please re-authenticate via `codex` CLI.");
		}

		if (!owner) {
			if (isLegacyApproval) {
				return { decision: "denied" };
			}
			return { decision: "decline" };
		}

		const cached = threadId && turnId && itemId ? state.cxItemCache.get(`${threadId}:${turnId}:${itemId}`) : null;

		// #29: Include structured approval context (command, cwd, commandActions, reason)
		// The SDK sends these in CommandExecutionRequestApprovalParams / FileChangeRequestApprovalParams.
		// Legacy requests (applyPatchApproval/execCommandApproval) are normalized to the same UI methods.
		const enrichedParams: any = {
			...params,
			cachedItem: cached,
			threadId,
			...(turnId ? { turnId } : {}),
			...(itemId ? { itemId } : {}),
		};

		// Ensure command & cwd from approval params are surfaced (they may differ from cachedItem)
		if (requestMethod === "item/commandExecution/requestApproval" || isLegacyExecApproval) {
			if (params.command && !enrichedParams.approvalCommand) enrichedParams.approvalCommand = params.command;
			if (params.cwd && !enrichedParams.approvalCwd) enrichedParams.approvalCwd = params.cwd;
			if (params.commandActions) enrichedParams.commandActions = params.commandActions;
			if (params.parsedCmd && !enrichedParams.commandActions) enrichedParams.commandActions = params.parsedCmd;
			const networkApprovalContext = params.networkApprovalContext ?? params.network_approval_context;
			if (networkApprovalContext && !enrichedParams.networkApprovalContext) {
				enrichedParams.networkApprovalContext = networkApprovalContext;
			}
			const proposedNetworkPolicyAmendments =
				params.proposedNetworkPolicyAmendments ?? params.proposed_network_policy_amendments;
			if (proposedNetworkPolicyAmendments && !enrichedParams.proposedNetworkPolicyAmendments) {
				enrichedParams.proposedNetworkPolicyAmendments = proposedNetworkPolicyAmendments;
			}
		}
		if (requestMethod === "item/fileChange/requestApproval" || isLegacyPatchApproval) {
			if (params.grantRoot) enrichedParams.grantRoot = params.grantRoot;
			if (params.fileChanges && !enrichedParams.fileChanges) enrichedParams.fileChanges = params.fileChanges;
		}
		if (requestMethod === "skill/requestApproval") {
			if (params.skillName && !enrichedParams.skillName) enrichedParams.skillName = params.skillName;
			if (params.itemId && !enrichedParams.itemId) enrichedParams.itemId = params.itemId;
		}

		const frontendMethod = isLegacyExecApproval
			? "item/commandExecution/requestApproval"
			: isLegacyPatchApproval
				? "item/fileChange/requestApproval"
				: requestMethod;

		// Route through emitCxStream so it maps to runtime_event
		deps.emitCxStream(
			threadId,
			{
				type: "request",
				requestId: String(r.id),
				method: frontendMethod,
				params: enrichedParams,
			} satisfies CodexStreamMessage,
			owner,
		);

		const response = await waitForPermission<CodexApprovalReply>(
			state.cxApprovalWaiters,
			String(r.id),
			deps.permissionTimeoutMs,
			{ response: "reject" },
		);

		return buildCodexApprovalDecision({
			requestMethod,
			isLegacyApproval,
			isLegacyExecApproval,
			response,
			requestParams: params,
			safeString,
		});
	};
}
