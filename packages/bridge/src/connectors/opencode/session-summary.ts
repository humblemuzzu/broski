/**
 * What an OpenCode session summary carries on the wire.
 *
 * A diff's `before`/`after` are whole file contents and a revert carries its own diff text, so a
 * list of a few thousand sessions was carrying megabytes the app never reads: it reads
 * `summary.diffs[].file` and whether a revert is active. Everything dropped here is verified
 * unused under `lib/`.
 */

import type { SessionSummary } from "../../types";
import { sessionPreview } from "../../utils/session-preview";

type SessionSummaryStats = NonNullable<SessionSummary["summary"]>;

function slimDiffs(stats: SessionSummaryStats): SessionSummaryStats["diffs"] {
	return stats.diffs?.map((diff) => ({
		file: diff.file,
		before: "",
		after: "",
		additions: diff.additions,
		deletions: diff.deletions,
		...(diff.status ? { status: diff.status } : {}),
	}));
}

function slimSummary(stats: SessionSummaryStats | undefined): Pick<SessionSummary, "summary"> | undefined {
	if (!stats) return undefined;
	const diffs = slimDiffs(stats);
	return {
		summary: {
			additions: stats.additions,
			deletions: stats.deletions,
			files: stats.files,
			...(diffs && diffs.length > 0 ? { diffs } : {}),
		},
	};
}

function slimRevert(revert: SessionSummary["revert"]): Pick<SessionSummary, "revert"> | undefined {
	if (!revert) return undefined;
	return { revert: { messageID: revert.messageID, ...(revert.partID ? { partID: revert.partID } : {}) } };
}

export function slimSessionSummary(session: SessionSummary): SessionSummary {
	return {
		id: session.id,
		title: sessionPreview(session.title),
		projectID: session.projectID,
		directory: session.directory,
		...(session.parentID ? { parentID: session.parentID } : {}),
		time: session.time,
		...(slimSummary(session.summary) ?? {}),
		...(session.share ? { share: { url: session.share.url } } : {}),
		...(slimRevert(session.revert) ?? {}),
	};
}
