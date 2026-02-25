import type { PermissionResponse } from "../../types";

type CodexApprovalReply = {
  response?: PermissionResponse;
  execpolicyAmendment?: any;
  networkPolicyAmendment?: { host: string; action: "allow" | "deny" };
  answers?: Record<string, { answers: string[] }>;
};

type BuildApprovalDecisionParams = {
  requestMethod: string;
  isLegacyApproval: boolean;
  isLegacyExecApproval: boolean;
  response: CodexApprovalReply;
  requestParams: any;
  safeString: (value: unknown) => string;
};

/**
 * Builds Codex server-request response payloads for approval + user input flows.
 */
export function buildCodexApprovalDecision({
  requestMethod,
  isLegacyApproval,
  isLegacyExecApproval,
  response,
  requestParams,
  safeString,
}: BuildApprovalDecisionParams): any {
  const isUserInput = requestMethod === "item/tool/requestUserInput";
  if (isUserInput && response.answers) {
    return { answers: response.answers };
  }

  const isSkillApproval = requestMethod === "skill/requestApproval";
  if (isSkillApproval) {
    const decision =
      response.response === "once" || response.response === "always"
        ? "approve"
        : "decline";
    return { decision };
  }

  const isCommandApproval =
    requestMethod === "item/commandExecution/requestApproval" ||
    isLegacyExecApproval;

  if (
    isCommandApproval &&
    response.response === "execpolicy" &&
    response.execpolicyAmendment
  ) {
    if (isLegacyApproval) {
      return {
        decision: {
          approved_execpolicy_amendment: {
            proposed_execpolicy_amendment: response.execpolicyAmendment,
          },
        },
      };
    }

    return {
      decision: {
        acceptWithExecpolicyAmendment: {
          execpolicyAmendment: response.execpolicyAmendment,
        },
      },
    };
  }

  const networkPolicyAmendment = (() => {
    if (response.networkPolicyAmendment?.host) {
      return {
        host: safeString(response.networkPolicyAmendment.host),
        action:
          response.networkPolicyAmendment.action === "deny" ? "deny" : "allow",
      } as const;
    }
    if (response.response !== "always") return null;

    const networkApprovalContext =
      requestParams.networkApprovalContext ??
      requestParams.network_approval_context;
    const contextHost = safeString(networkApprovalContext?.host);

    const proposedInput =
      requestParams.proposedNetworkPolicyAmendments ??
      requestParams.proposed_network_policy_amendments;
    const proposed = Array.isArray(proposedInput) ? proposedInput : [];
    const first = proposed.find(
      (entry: any) => entry && typeof entry === "object",
    ) as any;

    const host = safeString(first?.host) || contextHost;
    if (!host) return null;

    const action =
      safeString(first?.action).toLowerCase() === "deny" ? "deny" : "allow";
    return { host, action } as const;
  })();

  if (isLegacyApproval && networkPolicyAmendment) {
    return {
      decision: {
        network_policy_amendment: {
          network_policy_amendment: networkPolicyAmendment,
        },
      },
    };
  }

  if (isLegacyApproval) {
    const legacyDecision =
      response.response === "always"
        ? "approved_for_session"
        : response.response === "once"
          ? "approved"
          : "denied";
    return { decision: legacyDecision };
  }

  const decision =
    response.response === "always"
      ? "acceptForSession"
      : response.response === "once"
        ? "accept"
        : "decline";

  return { decision };
}
