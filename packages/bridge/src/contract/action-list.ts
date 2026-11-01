/**
 * A list of things a backend has, each with the actions a person may take on it (protocol 1.4): MCP servers, plugins,
 * background tasks, custom tools, the effective settings, the context window's parts. Several ops answer with it, each
 * under its own result `kind`; the phone draws every one the same way, by this shape. An op whose list has actions
 * takes an optional `ActionListChange`: the action is taken first and the answer is the list after it.
 */

import { z } from "zod";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

/** How a row's state reads at a glance; the label says what the state is. */
export const ActionListTone = z.enum(["neutral", "ok", "busy", "warning", "error"]);
export type ActionListTone = z.infer<typeof ActionListTone>;

/** A row's state as the backend words it (`connected`, `running`, `disabled`), with its tone. */
export const ActionListStatus = z.strictObject({
	label: z.string().min(1).max(MAX_NAME_CHARS),
	tone: ActionListTone,
});
export type ActionListStatus = z.infer<typeof ActionListStatus>;

/** One action on a row. A `destructive` one cannot be undone, so the phone asks before it sends it. */
export const ActionListAction = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	label: z.string().min(1).max(MAX_NAME_CHARS),
	destructive: z.boolean(),
});
export type ActionListAction = z.infer<typeof ActionListAction>;

/**
 * One thing in the list. `subtitle` is a line of detail (a value, a count, an error); `group` names the section the
 * row is listed under; `badges` are short labels (where a value comes from, that a policy manages it).
 */
export const ActionListRow = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	title: z.string().min(1).max(MAX_NAME_CHARS),
	subtitle: z.string().max(MAX_TEXT_CHARS).optional(),
	status: ActionListStatus.optional(),
	group: z.string().min(1).max(MAX_NAME_CHARS).optional(),
	badges: z.array(z.string().min(1).max(MAX_NAME_CHARS)).max(MAX_LIST_ITEMS),
	actions: z.array(ActionListAction).max(MAX_LIST_ITEMS),
});
export type ActionListRow = z.infer<typeof ActionListRow>;

/**
 * The rows in the backend's order; `omitted` counts the rows left out because the list is at its bound. `note` is
 * text about the list as a whole: a total, why it is empty, or what the action just taken printed.
 */
export const ActionList = z.strictObject({
	rows: z.array(ActionListRow).max(MAX_LIST_ITEMS),
	omitted: z.int().nonnegative(),
	note: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type ActionList = z.infer<typeof ActionList>;

/** Take the action `actionId` on the row `rowId`, both as the list named them. */
export const ActionListChange = z.strictObject({
	rowId: z.string().min(1).max(MAX_ID_CHARS),
	actionId: z.string().min(1).max(MAX_ID_CHARS),
});
export type ActionListChange = z.infer<typeof ActionListChange>;
