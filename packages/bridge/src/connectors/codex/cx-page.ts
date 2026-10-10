/**
 * Cursor for a paged Codex transcript read.
 *
 * The index counts messages from the start of the transcript, which keeps an older page stable when
 * the rollout grows at the end. The source tag records which reader built the transcript, because
 * the app-server's turn list and the rollout file derive their messages independently.
 */

import type { CodexTranscriptMessage } from "../../types";
import type { TranscriptPage } from "../../types/transcript-page";

export type CxPageSource = "rpc" | "file";
export type CxPageCursor = { source: CxPageSource; index: number };

export function parseCxPageCursor(value: string | undefined): CxPageCursor | null {
	if (!value) return null;
	const match = /^(rpc|file):(\d+)$/.exec(value);
	if (!match) return null;
	return { source: match[1] as CxPageSource, index: Number.parseInt(match[2] as string, 10) };
}

export function cxPageFields(
	source: CxPageSource,
	page: TranscriptPage<CodexTranscriptMessage>,
): { hasMore: boolean; nextCursor?: string } {
	if (!page.nextCursor) return { hasMore: page.hasMore };
	return { hasMore: page.hasMore, nextCursor: `${source}:${page.nextCursor}` };
}
