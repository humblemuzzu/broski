/**
 * The entries a fork holds, as Pi's own `createBranchedSession` builds them (pi-coding-agent
 * `src/core/session-manager.ts:1632-1717`): the branch without its `label` entries, every entry chained
 * under the one kept before it, then one fresh `label` entry per label the whole file resolves for a kept entry.
 */

import { randomUUID } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type EntrySpan, readEntries, type SessionFileIndex } from "./jsonl-reader";

type LabelEntry = Extract<SessionEntry, { type: "label" }>;

/** One entry of the branch as the fork writes it. */
export interface ForkedEntry {
	readonly span: EntrySpan;
	readonly parentId: string | null;
	/** A compaction whose first kept entry was a dropped label keeps the entry that followed the label instead. */
	readonly firstKeptEntryId?: string;
}

export interface ForkContents {
	readonly entries: readonly ForkedEntry[];
	readonly labels: readonly LabelEntry[];
}

/** `rootId` is the entry the first kept one hangs under: the fork's `broski.origin` entry, or none. */
export async function forkContents(
	file: SessionFileIndex,
	branch: readonly EntrySpan[],
	rootId: string | null,
): Promise<ForkContents> {
	const kept: EntrySpan[] = [];
	const replacements = new Map<string, string>();
	let pendingLabels: string[] = [];
	for (const span of branch) {
		if (span.type === "label") {
			pendingLabels.push(span.entryId);
			continue;
		}
		for (const labelId of pendingLabels) replacements.set(labelId, span.entryId);
		pendingLabels = [];
		kept.push(span);
	}
	const firstKept = await replacedFirstKept(file, kept, replacements);
	const entries = kept.map((span, position): ForkedEntry => {
		const replaced = firstKept.get(span.entryId);
		return {
			span,
			parentId: position === 0 ? rootId : (kept[position - 1]?.entryId ?? rootId),
			...(replaced !== undefined && { firstKeptEntryId: replaced }),
		};
	});
	const lastId = kept.at(-1)?.entryId ?? rootId;
	return { entries, labels: await recreatedLabels(file, kept, lastId, rootId) };
}

/** Compactions of `kept` whose `firstKeptEntryId` names a dropped label, with the id that replaces it. */
async function replacedFirstKept(
	file: SessionFileIndex,
	kept: readonly EntrySpan[],
	replacements: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	if (replacements.size === 0) return found;
	const compactions = kept.filter((span) => span.type === "compaction");
	for (const entry of await readEntries(file, compactions)) {
		if (entry?.type !== "compaction" || entry.firstKeptEntryId === entry.id) continue;
		const replacement = replacements.get(entry.firstKeptEntryId);
		if (replacement !== undefined) found.set(entry.id, replacement);
	}
	return found;
}

/**
 * The labels the file resolves (each `label` entry in file order sets its target's label, an empty one clears
 * it, `_buildIndex` `:1103-1122`) for the kept entries, in the order Pi's map holds them, chained after `lastId`.
 */
async function recreatedLabels(
	file: SessionFileIndex,
	kept: readonly EntrySpan[],
	lastId: string | null,
	rootId: string | null,
): Promise<LabelEntry[]> {
	const resolved = new Map<string, { label: string; timestamp: string }>();
	const labelSpans = file.entries.filter((span) => span.type === "label");
	for (const entry of await readEntries(file, labelSpans)) {
		if (entry?.type !== "label") continue;
		if (entry.label) resolved.set(entry.targetId, { label: entry.label, timestamp: entry.timestamp });
		else resolved.delete(entry.targetId);
	}
	const keptIds = new Set(kept.map((span) => span.entryId));
	const taken = new Set(keptIds);
	if (rootId !== null) taken.add(rootId);
	const labels: LabelEntry[] = [];
	let parentId = lastId;
	for (const [targetId, { label, timestamp }] of resolved) {
		if (!keptIds.has(targetId)) continue;
		const id = freshEntryId(taken);
		taken.add(id);
		labels.push({ type: "label", id, parentId, timestamp, targetId, label });
		parentId = id;
	}
	return labels;
}

/** Pi's 8 hex characters, unused among `taken` (`generateId`, pi-coding-agent `src/core/session-manager.ts:277-284`). */
export function freshEntryId(taken: { has(id: string): boolean }): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = randomUUID().slice(0, 8);
		if (!taken.has(id)) return id;
	}
	return randomUUID();
}
