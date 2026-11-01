/** Building an `ActionList` from SDK values within the contract's bounds, and taking an action on one of its rows. */

import {
	type ActionList,
	type ActionListAction,
	type ActionListChange,
	type ActionListRow,
	type ActionListTone,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type Rejected,
} from "../../../contract";
import { clip, fitsId, nameOr } from "../bounds";
import { rejected } from "../rejections";

export interface RowSpec {
	readonly id: string;
	readonly title: string;
	readonly subtitle?: string;
	readonly status?: { readonly label: string; readonly tone: ActionListTone };
	readonly group?: string;
	readonly badges?: readonly string[];
	readonly actions?: readonly ActionListAction[];
}

export function action(id: string, label: string, destructive = false): ActionListAction {
	return { id, label, destructive };
}

function rowOf(spec: RowSpec): ActionListRow {
	return {
		id: spec.id,
		title: nameOr(spec.title, spec.id),
		...(spec.subtitle !== undefined && spec.subtitle !== "" && { subtitle: clip(spec.subtitle, MAX_TEXT_CHARS) }),
		...(spec.status && { status: { label: nameOr(spec.status.label, spec.status.tone), tone: spec.status.tone } }),
		...(spec.group !== undefined && spec.group !== "" && { group: clip(spec.group, MAX_NAME_CHARS) }),
		badges: (spec.badges ?? [])
			.filter((badge) => badge !== "")
			.map((badge) => clip(badge, MAX_NAME_CHARS))
			.slice(0, MAX_LIST_ITEMS),
		actions: [...(spec.actions ?? [])].slice(0, MAX_LIST_ITEMS),
	};
}

/**
 * The rows in the given order. A row whose id does not fit, or repeats an earlier one, is left out and counted in
 * `omitted`, like every row past the bound: an id is never cut, since a cut id would name another row.
 */
export function actionList(specs: readonly RowSpec[], note?: string): ActionList {
	const seen = new Set<string>();
	const rows: ActionListRow[] = [];
	let omitted = 0;
	for (const spec of specs) {
		if (!fitsId(spec.id) || seen.has(spec.id) || rows.length >= MAX_LIST_ITEMS) {
			omitted += 1;
			continue;
		}
		seen.add(spec.id);
		rows.push(rowOf(spec));
	}
	return { rows, omitted, ...(note !== undefined && note !== "" && { note: clip(note, MAX_TEXT_CHARS) }) };
}

/** The row and the action a change names; an unknown row is `not_found`, an action the row does not offer `invalid_input`. */
export function findAction(
	rows: readonly ActionListRow[],
	change: ActionListChange,
): { readonly row: ActionListRow; readonly action: ActionListAction } | Rejected {
	const row = rows.find((candidate) => candidate.id === change.rowId);
	if (row === undefined) return rejected("not_found", `no row ${change.rowId}`);
	const taken = row.actions.find((candidate) => candidate.id === change.actionId);
	return taken === undefined
		? rejected("invalid_input", `${row.title} does not offer ${change.actionId}`)
		: { row, action: taken };
}
