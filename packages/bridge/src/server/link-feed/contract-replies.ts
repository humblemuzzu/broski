import type { PermissionOption, ToolPermissionReply, ToolPermissionRequest } from "../../contract";

/** The replies a lock-screen verdict stands for; a verdict whose reply is absent cannot be given there. */
export type PermissionVerdicts = { allow?: ToolPermissionReply; deny?: ToolPermissionReply };

/**
 * Allow is the plain allow-once the request offers, never a wider grant, and not at all when the
 * request asks the person to look closer (`deliberate`) or the allowing option needs a message.
 * Deny is the plain deny-once that does not stop the run.
 */
export function permissionVerdicts(request: ToolPermissionRequest): PermissionVerdicts {
	const allow = request.deliberate ? undefined : plainOption(request.options, "allow");
	const deny = plainOption(request.options, "deny");
	return {
		...(allow && {
			allow: replyWith(
				allow,
				request.grants.map((grant) => grant.id),
			),
		}),
		...(deny && { deny: replyWith(deny, []) }),
	};
}

function plainOption(
	options: readonly PermissionOption[],
	effect: PermissionOption["effect"],
): PermissionOption | undefined {
	return options.find(
		(option) =>
			option.effect === effect && option.scope === "once" && !option.stopsRun && option.message !== "required",
	);
}

function replyWith(option: PermissionOption, grantIds: string[]): ToolPermissionReply {
	return { kind: "tool_permission", optionId: option.id, grantIds };
}
