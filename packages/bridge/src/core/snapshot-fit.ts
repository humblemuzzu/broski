import type { SessionSnapshot } from "../contract";
import { frameBytes } from "../transport/send-limits";

/**
 * `snapshot` without as few of its active run's oldest items as it takes for the frame `bytesOf`
 * measures to fit `maxBytes`, counted in `run.droppedItems` as the contract does for a run past its
 * bound; the transcript has them once the run ends. Every item goes when even the newest does not fit.
 */
export function withoutOldestItems(
	snapshot: SessionSnapshot,
	bytesOf: (snapshot: SessionSnapshot) => number,
	maxBytes: number,
): SessionSnapshot {
	const run = snapshot.run;
	if (!run || run.items.length === 0) return snapshot;
	const count = run.items.length;
	// The empty run is measured with the largest `droppedItems` it can end up with, so the estimate never falls short.
	const empty = bytesOf({ ...snapshot, run: { ...run, items: [], droppedItems: run.droppedItems + count } });
	const sizes = run.items.map((item) => frameBytes(JSON.stringify(item)));
	let total = empty + sizes.reduce((sum, size) => sum + size + 1, -1);
	let dropped = 0;
	for (const size of sizes) {
		if (total <= maxBytes) break;
		total -= size + (dropped < count - 1 ? 1 : 0);
		dropped += 1;
	}
	if (dropped === 0) return snapshot;
	return { ...snapshot, run: { ...run, items: run.items.slice(dropped), droppedItems: run.droppedItems + dropped } };
}
