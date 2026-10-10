import type { ClientMessage } from "../types";

/**
 * Per-domain message unions derived from `ClientMessage`. Handlers take the
 * message narrowed to the types they own instead of `any`, so a field read is
 * checked against the wire contract at compile time.
 */
export type CcMessage = Extract<ClientMessage, { type: `cc_${string}` }> & { requestId?: string };
export type CxMessage = Extract<ClientMessage, { type: `cx_${string}` }> & { requestId?: string };
export type OcMessage = Extract<ClientMessage, { type: `oc_${string}` }> & { requestId?: string };
export type PiMessage = Extract<ClientMessage, { type: `pi_${string}` }> & {
	requestId?: string;
	projectPath?: string;
	cwd?: string;
};
export type UnifiedMessage = Extract<ClientMessage, { type: `unified_${string}` }> & { requestId?: string };
export type PdMessage = Extract<ClientMessage, { type: `pd_${string}` }> & { requestId?: string };
export type GitMessage = Extract<ClientMessage, { type: `git_${string}` | `github_${string}` }> & {
	requestId?: string;
};

/** One specific message type plus the `requestId` the dispatcher echoes back. */
export type Msg<T extends ClientMessage["type"]> = Extract<ClientMessage, { type: T }> & { requestId?: string };
