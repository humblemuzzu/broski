/** Lane C · the `permissions` axis as listed (D12): labels, warnings, `auto` only where a model supports it. */

import type { ModelInfo, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ModeAxis, Option } from "../../contract";
import { DEFAULT_PERMISSION_MODE, PERMISSION_MODES, PERMISSIONS_AXIS } from "./permission-modes";

const TEXT: {
	readonly [M in PermissionMode]: {
		readonly label: string;
		readonly description: string;
	};
} = {
	default: {
		label: "Ask first",
		description: "Standard behavior: Claude asks before dangerous operations.",
	},
	acceptEdits: {
		label: "Accept edits",
		description: "File edits go through without asking; other risky tools still ask.",
	},
	plan: {
		label: "Plan",
		description: "Claude plans and changes nothing until you approve the plan.",
	},
	auto: {
		label: "Auto",
		description: "A model classifier approves or denies each permission prompt.",
	},
	dontAsk: {
		label: "Don't ask",
		description: "Never asks: anything not already allowed is denied.",
	},
	bypassPermissions: {
		label: "Bypass permissions",
		description:
			"Warning: skips every permission check, so edits and shell commands run without asking. Use it only where a mistake costs nothing.",
	},
};

/** `auto` is a property of a model (`supportsAutoMode`, `d.ts:1478`), and the axis is the backend's, so one model offering it is enough. */
export function permissionsAxis(models: readonly ModelInfo[], mayBypass: boolean): ModeAxis {
	const autoOffered = models.some((model) => model.supportsAutoMode === true);
	const offered = (mode: PermissionMode) =>
		(mode !== "auto" || autoOffered) && (mode !== "bypassPermissions" || mayBypass);
	const options: Option[] = PERMISSION_MODES.filter(offered).map((mode) => ({
		value: mode,
		...TEXT[mode],
	}));
	return {
		id: PERMISSIONS_AXIS,
		label: "Permissions",
		description: "What Claude may do without asking you first.",
		options,
		defaultValue: DEFAULT_PERMISSION_MODE,
	};
}
