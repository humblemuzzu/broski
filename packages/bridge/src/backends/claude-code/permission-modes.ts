/**
 * The one mode axis, `permissions`, whose values are the SDK's `PermissionMode`s (D13). Its listing (labels, which
 * values a model offers) is `modes.ts`; this is what a value is checked against.
 */

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ModeAxisId } from "../../contract";

export const PERMISSIONS_AXIS: ModeAxisId = "permissions";

/** A new session's mode when the phone names none (D13); always passed, since an omitted mode is not `default` (D5). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "default";

const MODES: { readonly [M in PermissionMode]: true } = {
	default: true,
	acceptEdits: true,
	plan: true,
	auto: true,
	dontAsk: true,
	bypassPermissions: true,
};

/** In the order the phone lists them: `auto` only when a model `supportsAutoMode`, which `modes.ts` decides. */
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
