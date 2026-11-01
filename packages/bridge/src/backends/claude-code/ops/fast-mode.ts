/**
 * Fast mode in `session_settings` (Step 7): session-only, set through `applyFlagSettings({fastMode})` like the effort
 * (D11). The 2.1.316 binary refuses fast mode to an SDK session (`sdk_opt_in_required`) unless the flag layer says
 * `fastMode: true`, so the flag is the opt-in itself. What the session runs with is the CLI's own word: the
 * `fast_mode_state` of the host's latest `system/init` (`HostView.latestInit`). Offered only on a live host whose
 * model the CLI says `supportsFastMode` (`ModelInfo`).
 */

import type { FastModeDisabledReason, ModelInfo, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Rejected, SessionSetting } from "../../../contract";
import type { HostView } from "../ports";
import { rejected } from "../rejections";
import { messageOf } from "./host-access";

export const FAST_MODE = "fastMode";

const NEXT_MESSAGE = "Takes effect from the next message.";
const COOLDOWN = "Paused after a rate limit; it comes back on by itself.";

/** Why the CLI says fast mode cannot serve, for a toggle that is on; `sdk_opt_in_required` is just the toggle off. */
const BLOCKED: { readonly [R in FastModeDisabledReason]: string | undefined } = {
	free: "Fast mode is not part of this account's plan.",
	preference: "Fast mode is turned off by a setting or your organization.",
	extra_usage_disabled: "Fast mode needs extra usage, which is turned off for this account.",
	network_error: "Claude Code could not check fast mode availability.",
	unknown: "Fast mode is not available right now.",
	not_first_party: "Fast mode is only available when using the Anthropic API directly.",
	disabled_by_env: "Fast mode is turned off by an environment variable.",
	model_not_allowed: "This model is not in your organization's allowed models.",
	sdk_opt_in_required: undefined,
	pending: "Checking fast mode availability.",
};

/** Whether the CLI's own model list says the session's model runs in fast mode. */
export function modelSupportsFastMode(init: SDKSystemMessage, models: readonly ModelInfo[]): boolean {
	return models.some(
		(model) => (model.value === init.model || model.resolvedModel === init.model) && model.supportsFastMode === true,
	);
}

/** The toggle as the CLI reported it, or as just asked for (`requested`) until the next `init` says. */
export function fastModeItem(init: SDKSystemMessage, requested?: boolean): SessionSetting {
	const state = init.fast_mode_state ?? "off";
	const enabled = requested ?? state !== "off";
	const reason = init.fast_mode_disabled_reason;
	const note =
		requested !== undefined
			? NEXT_MESSAGE
			: state === "cooldown"
				? COOLDOWN
				: enabled || reason === undefined
					? undefined
					: BLOCKED[reason];
	return {
		kind: "toggle",
		key: FAST_MODE,
		label: "Fast mode",
		description: "Faster answers from the same model. For this session only.",
		enabled,
		...(note !== undefined && { note }),
	};
}

export async function setFastMode(host: HostView, enabled: boolean): Promise<Rejected | undefined> {
	try {
		await host.query.applyFlagSettings({ fastMode: enabled });
		return undefined;
	} catch (error) {
		return rejected("backend_error", `fast mode could not be set: ${messageOf(error)}`);
	}
}
