/**
 * Shared session diff statistics utilities.
 * Used by all 4 backend connectors to compute code change summaries.
 */

export type SessionDiffSummary = {
	additions: number;
	deletions: number;
	files: number;
};

/** Count additions (+) and deletions (-) in a unified diff string. */
export function countUnifiedDiffStats(diff: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of diff.split("\n")) {
		// Skip diff headers
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) additions++;
		else if (line.startsWith("-")) deletions++;
	}
	return { additions, deletions };
}

/** Merge per-file stats into a session-level summary. Dedupes by file path (last write wins). */
export function aggregateFileDiffs(
	diffs: Array<{ file: string; additions: number; deletions: number }>,
): SessionDiffSummary {
	// Accumulate per-file (same file edited multiple times → sum all edits)
	const byFile = new Map<string, { additions: number; deletions: number }>();
	for (const d of diffs) {
		if (!d.file) continue;
		const existing = byFile.get(d.file);
		if (existing) {
			existing.additions += d.additions;
			existing.deletions += d.deletions;
		} else {
			byFile.set(d.file, { additions: d.additions, deletions: d.deletions });
		}
	}

	let additions = 0;
	let deletions = 0;
	for (const v of byFile.values()) {
		additions += v.additions;
		deletions += v.deletions;
	}

	return { additions, deletions, files: byFile.size };
}

/** Empty summary constant for sessions with no file changes. */
export const EMPTY_SUMMARY: SessionDiffSummary = { additions: 0, deletions: 0, files: 0 };
