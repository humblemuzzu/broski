/**
 * What the bridge and its extension in a hosted `pi` (`./extension/index.ts`) say to each other, over Pi's own RPC:
 * the extension's permission request is an `input` dialog whose title holds the call as JSON, answered with the
 * human's verdict as JSON text (pi-coding-agent 1.5.2 `docs/rpc-extension-ui.md:65-79, 176-180`); a record reaches
 * the extension as its command, sent as a prompt, which Pi runs at once even mid-run (`docs/rpc-commands.md:31`).
 */

import { z } from "zod";
import type { JsonValue } from "../../../contract";
import type { BroskiRecord } from "../broski-entries";

/** The extension's command; a prompt that names it is the bridge's, never the phone's. */
export const HOST_COMMAND = "broski-host";

const ASK_PREFIX = "broski-permission:";

const PermissionAsk = z.object({
	toolCallId: z.string(),
	/** The call that made this one through `ctx.executeTool()`. */
	parentToolCallId: z.string().optional(),
	toolName: z.string(),
	input: z.unknown(),
	cwd: z.string(),
	/** Why the human's edit of the input was refused, when this asks again. */
	problem: z.string().optional(),
});
export type PermissionAsk = z.output<typeof PermissionAsk>;

/** The call an `input` dialog's title asks about; undefined for any other dialog. */
export function permissionAskOf(title: string): PermissionAsk | undefined {
	if (!title.startsWith(ASK_PREFIX)) return undefined;
	try {
		const parsed = PermissionAsk.safeParse(JSON.parse(title.slice(ASK_PREFIX.length)));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

export type PermissionVerdict =
	| { readonly decision: "allow" | "allow_session"; readonly input?: JsonValue }
	| { readonly decision: "deny"; readonly message: string };

export function verdictText(verdict: PermissionVerdict): string {
	return JSON.stringify(verdict);
}

/** The prompt text that has the extension append `record` to the session. */
export function recordCommand(record: BroskiRecord): string {
	return `/${HOST_COMMAND} ${JSON.stringify(record)}`;
}
