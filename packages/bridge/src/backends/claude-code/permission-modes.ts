/**
 * D12's one mode axis, `permissions`, whose values are the SDK's `PermissionMode`s. The listing (labels, which values
 * a model offers, a project's `defaultMode`) is lane C's `modes.ts`; this is what every lane checks a value against.
 */

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ModeAxisId } from "../../contract";

export const PERMISSIONS_AXIS: ModeAxisId = "permissions";

/** A new session's mode when the phone names none (D12); never omitted, since omitted is not `default` (fact 5). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "default";

const MODES: { readonly [M in PermissionMode]: true } = {
	default: true,
	acceptEdits: true,
	plan: true,
	auto: true,
	dontAsk: true,
	bypassPermissions: true,
};

/** In D12's order: `auto` only when the model `supportsAutoMode`, which `modes.ts` decides. */
export const PERMISSION_MODES: readonly PermissionMode[] = [
	"default",
	"acceptEdits",
	"plan",
	"auto",
	"dontAsk",
	"bypassPermissions",
];

export function isPermissionMode(value: string): value is PermissionMode {
	return Object.hasOwn(MODES, value);
}
