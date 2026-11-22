/** What the MCP server needs of the bridge: `BridgeCore.raiseExternalInteraction` and `emitExternalNotice`. */

import type {
	ActionResult,
	InteractionOrigin,
	InteractionReply,
	InteractionRequest,
	NoticeLevel,
	SessionRef,
} from "../contract";

export interface ExternalInteractionSpec {
	readonly title: string;
	readonly body?: string;
	readonly blocksRun?: boolean;
	readonly origin?: InteractionOrigin;
	readonly request: InteractionRequest;
}

export type ExternalInteractionOutcome =
	| { readonly kind: "answered"; readonly reply: InteractionReply }
	| { readonly kind: "ended"; readonly reason: "withdrawn" | "expired" };

export interface ExternalNoticeSpec {
	readonly level: NoticeLevel;
	readonly text: string;
	readonly urgent?: boolean;
}

export interface McpBridgeSink {
	/** Settles `ended: withdrawn` once `signal` aborts. */
	raiseExternalInteraction(
		session: SessionRef,
		spec: ExternalInteractionSpec,
		signal: AbortSignal,
	): Promise<ExternalInteractionOutcome>;
	emitExternalNotice(session: SessionRef, notice: ExternalNoticeSpec): Promise<ActionResult>;
}
