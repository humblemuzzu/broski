/**
 * The background tasks an extension announces with `pi.events.emit("broski:tasks", tasks)`, each in the contract's own
 * `BackgroundTask` shape (`docs/architecture/backends/pi/extension-hints.md`). The bridge's extensions pass the list
 * on: the host extension as a `setStatus` under the same key, the terminal link as a `tasks` event.
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import {
	type BackgroundTask,
	BackgroundTask as BackgroundTaskSchema,
	MAX_LIST_ITEMS,
	MAX_TEXT_CHARS,
} from "../../../contract";
import { clipStart } from "../bounds";
import { phoneName } from "../phone-text";

export const TASKS_KEY = "broski:tasks";

/** A task names no session: an extension knows none of the bridge's. */
const Announced = BackgroundTaskSchema.omit({ childSession: true });

/** The tasks of a list, each id once; an entry that is no task is left out. Undefined for what is no list. */
export function announcedTasks(value: unknown): BackgroundTask[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const seen = new Set<string>();
	return value.slice(0, MAX_LIST_ITEMS).flatMap((entry): BackgroundTask[] => {
		const task = taskOf(entry);
		if (task === undefined || seen.has(task.id)) return [];
		seen.add(task.id);
		return [task];
	});
}

/** The status text the host extension passes the list in. */
export function tasksOfStatus(text: string | undefined): BackgroundTask[] | undefined {
	if (text === undefined) return [];
	try {
		return announcedTasks(JSON.parse(text));
	} catch {
		return undefined;
	}
}

function taskOf(entry: unknown): BackgroundTask | undefined {
	if (!isRecord(entry)) return undefined;
	const { id, kind, title, command, startedAt } = entry;
	const parsed = Announced.safeParse({
		id,
		kind,
		title: typeof title === "string" ? phoneName(title).replace(/\s+/g, " ").trim() : title,
		...(typeof command === "string" && command !== "" && { command: clipStart(command, MAX_TEXT_CHARS) }),
		...(typeof startedAt === "number" && { startedAt: Math.round(startedAt) }),
	});
	return parsed.success ? parsed.data : undefined;
}
