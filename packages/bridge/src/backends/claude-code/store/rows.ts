/** One `SessionSummary` from an `SDKSessionInfo` (D24). */

import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import {
	MAX_PATH_CHARS,
	type SessionOrigin,
	type SessionParent,
	type SessionSummary,
	type SessionTitle,
	type TitleSource,
} from "../../../contract";
import { nameOr } from "../bounds";
import { isUuid } from "../ids";
import type { LiveRow } from "../ports/store";

export interface RowContext {
	readonly origin: SessionOrigin;
	/** When the conversation last moved (`activity.ts`); the SDK's `lastModified` only when the file is gone. */
	readonly updatedAt: number | undefined;
	/** `customTitle` is a person's (`title-source.ts`), not the AI title the SDK folds into it. */
	readonly userTitled?: boolean;
	readonly live?: LiveRow;
	readonly parent?: SessionParent;
}

function titleSource(info: SDKSessionInfo, userTitled: boolean): TitleSource {
	if (userTitled) return "user";
	if (info.customTitle !== undefined && info.customTitle !== "") return "generated";
	return info.firstPrompt !== undefined && info.summary === info.firstPrompt ? "first_prompt" : "generated";
}

function titleOf(info: SDKSessionInfo, userTitled: boolean): SessionTitle {
	const text = info.customTitle !== undefined && info.customTitle !== "" ? info.customTitle : info.summary;
	return {
		text: nameOr(text, info.firstPrompt ?? info.sessionId),
		source: titleSource(info, userTitled),
	};
}

function timestamp(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

/** Undefined for a row the contract cannot carry (an id that is not a UUID). */
export function sessionRow(info: SDKSessionInfo, context: RowContext): SessionSummary | undefined {
	if (!isUuid(info.sessionId)) return undefined;
	const createdAt = timestamp(info.createdAt);
	const cwd = info.cwd !== undefined && info.cwd !== "" && info.cwd.length <= MAX_PATH_CHARS ? info.cwd : undefined;
	return {
		session: { backend: "claude-code", sessionId: info.sessionId },
		title: titleOf(info, context.userTitled === true),
		...(cwd !== undefined && { cwd }),
		...(createdAt !== undefined && { createdAt }),
		updatedAt: context.updatedAt ?? timestamp(info.lastModified) ?? 0,
		...(context.parent !== undefined && { parent: context.parent }),
		...(context.live?.modelId !== undefined && {
			modelId: context.live.modelId,
		}),
		status: context.live?.status ?? "unknown",
		origin: context.origin,
	};
}
