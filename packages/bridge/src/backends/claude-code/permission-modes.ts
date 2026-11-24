/**
 * The one mode axis, `permissions`, whose values are the SDK's `PermissionMode`s (D13). Its listing (labels, which
 * values a model offers) is `modes.ts`; this is what a value is checked against.
 */

import type {
	PermissionMode,
	ResolvedSettings,
	ResolveSettingsOptions,
	Settings,
} from "@anthropic-ai/claude-agent-sdk";
import type { ModeAxisId } from "../../contract";

export interface SettingsReader {
	resolveSettings(options?: ResolveSettingsOptions): Promise<ResolvedSettings>;
	filterEscalatingDefaultMode(resolved: ResolvedSettings): Settings;
}

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

/**
 * Reads the user's configured `permissions.defaultMode` in-process (no CLI probe), applying the
 * SDK's trust-tier filter so repo-committed escalating modes are ignored just as the CLI ignores them.
 */
export async function defaultPermissionMode(
	sdk: SettingsReader,
	cwd: string | undefined,
	mayBypass: boolean,
): Promise<PermissionMode> {
	const resolved = await sdk
		.resolveSettings(cwd !== undefined ? { cwd } : { settingSources: ["user"] })
		.catch(() => undefined);
	const configured = resolved ? sdk.filterEscalatingDefaultMode(resolved).permissions?.defaultMode : undefined;
	if (configured === undefined || !isPermissionMode(configured)) return DEFAULT_PERMISSION_MODE;
	if (configured === "bypassPermissions" && !mayBypass) return DEFAULT_PERMISSION_MODE;
	return configured;
}
