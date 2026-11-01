/**
 * Harness activities as a client below 1.4 reads them: an info `notice` (a warning when the activity failed), in the
 * live stream with the event's `seq` and in a run's items or a transcript page under the activity's own id (contract
 * README §12.4). Each function gives back the value it was given when it holds nothing to change.
 */

import type {
	Activity,
	ActivityStatus,
	NoticeEvent,
	NoticeItem,
	TranscriptItem,
	TranscriptReadResult,
} from "../contract";
import { clipped } from "./clipped-text";

const STATUS_WORDS: Readonly<Record<ActivityStatus, string>> = {
	running: "running",
	succeeded: "done",
	failed: "failed",
	cancelled: "cancelled",
};

function textOf(activity: Activity): string {
	const occasion = activity.detail === undefined ? "" : ` (${activity.detail})`;
	const took = activity.durationMs === undefined ? "" : ` in ${activity.durationMs} ms`;
	const line = `${activity.label}${occasion}: ${STATUS_WORDS[activity.status]}${took}`;
	return clipped(activity.output ? `${line}\n\n${activity.output}` : line);
}

function levelOf(activity: Activity): NoticeEvent["level"] {
	return activity.status === "failed" ? "warning" : "info";
}

export function activityNotice(activity: Activity): NoticeEvent {
	return { type: "notice", level: levelOf(activity), text: textOf(activity) };
}

function itemBefore14(item: TranscriptItem): TranscriptItem {
	if (item.kind !== "activity") return item;
	const { kind: _kind, at, ...activity } = item;
	const notice: NoticeItem = { kind: "notice", id: item.id, level: levelOf(activity), text: textOf(activity) };
	return at === undefined ? notice : { ...notice, at };
}

export function itemsBefore14(items: readonly TranscriptItem[]): readonly TranscriptItem[] {
	return items.some((item) => item.kind === "activity") ? items.map(itemBefore14) : items;
}

export function transcriptBefore14(result: TranscriptReadResult): TranscriptReadResult {
	if (result.status !== "accepted") return result;
	const items = itemsBefore14(result.page.items);
	return items === result.page.items ? result : { ...result, page: { ...result.page, items: [...items] } };
}
