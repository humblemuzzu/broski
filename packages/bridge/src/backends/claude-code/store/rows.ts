/** Lane A · one `SessionSummary` from an `SDKSessionInfo` (D16). */

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
	readonly live?: LiveRow;
	readonly parent?: SessionParent;
}

function titleSource(info: SDKSessionInfo): TitleSource {
	if (info.customTitle !== undefined && info.customTitle !== "") return "user";
	return info.firstPrompt !== undefined && info.summary === info.firstPrompt ? "first_prompt" : "generated";
}

function titleOf(info: SDKSessionInfo): SessionTitle {
	const text = info.customTitle !== undefined && info.customTitle !== "" ? info.customTitle : info.summary;
	return {
		text: nameOr(text, info.firstPrompt ?? info.sessionId),
		source: titleSource(info),
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
		title: titleOf(info),
		...(cwd !== undefined && { cwd }),
		...(createdAt !== undefined && { createdAt }),
		updatedAt: timestamp(info.lastModified) ?? 0,
		...(context.parent !== undefined && { parent: context.parent }),
		archived: false,
		...(context.live?.modelId !== undefined && {
			modelId: context.live.modelId,
		}),
		status: context.live?.status ?? "unknown",
		origin: context.origin,
	};
}
